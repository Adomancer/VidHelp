<?php

namespace App\Services;

use App\Models\BackupRequest;
use App\Models\EventSlotClaim;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;

/**
 * When a host (or a brand) is already busy: regular slots that run that day,
 * backups being covered, and claimed event blocks.
 */
class HostCalendar
{
    public function __construct(private EventCalendar $events)
    {
    }

    /**
     * Why the host is busy at some point between `$start` and `$end`, or null if free.
     */
    public function busyReason(
        HostProfile $host,
        CarbonInterface $start,
        CarbonInterface $end,
        ?string $exceptBackupId = null,
        ?string $exceptClaimId = null,
    ): ?string {
        return $this->reasonIn($this->hostIntervals($host, $start, $end, $exceptBackupId, $exceptClaimId), $start, $end);
    }

    /**
     * Everything that keeps the host busy between two moments, each with a reason.
     *
     * @return Collection<int, array{start: CarbonImmutable, end: CarbonImmutable, reason: string}>
     */
    public function hostIntervals(
        HostProfile $host,
        CarbonInterface $from,
        CarbonInterface $to,
        ?string $exceptBackupId = null,
        ?string $exceptClaimId = null,
    ): Collection {
        $slots = ScheduleSlot::query()
            ->with('assignment.brand:id,name')
            ->where('status', 'active')
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id)->where('status', 'active'))
            ->get();

        $intervals = $this->slotIntervals($slots, $from, $to, fn (ScheduleSlot $slot) => "Live on {$slot->assignment->brand->name} ({$slot->label()}).");

        BackupRequest::query()
            ->with('brand:id,name')
            ->where('status', 'filled')
            ->where('filled_by_host_id', $host->id)
            ->when($exceptBackupId, fn ($q) => $q->whereKeyNot($exceptBackupId))
            ->where('start_at', '<', $to)
            ->where('end_at', '>', $from)
            ->get()
            ->each(fn (BackupRequest $cover) => $intervals->push([
                'start' => CarbonImmutable::parse($cover->start_at),
                'end' => CarbonImmutable::parse($cover->end_at),
                'reason' => "Already covering {$cover->brand->name} at that time.",
            ]));

        EventSlotClaim::active()
            ->with('event:id,name')
            ->where('host_id', $host->id)
            ->when($exceptClaimId, fn ($q) => $q->whereKeyNot($exceptClaimId))
            ->where('start_at', '<', $to)
            ->where('end_at', '>', $from)
            ->get()
            ->each(fn (EventSlotClaim $claim) => $intervals->push([
                'start' => CarbonImmutable::parse($claim->start_at),
                'end' => CarbonImmutable::parse($claim->end_at),
                'reason' => "Booked for {$claim->event->name} at that time.",
            ]));

        return $intervals;
    }

    /**
     * When a brand's regular schedule already has someone live (for events that keep the regular schedule).
     *
     * @return Collection<int, array{start: CarbonImmutable, end: CarbonImmutable, reason: string}>
     */
    public function brandIntervals(string $brandId, CarbonInterface $from, CarbonInterface $to): Collection
    {
        $slots = ScheduleSlot::query()
            ->with('assignment.host.user')
            ->where('status', 'active')
            ->whereHas('assignment', fn ($q) => $q->where('brand_id', $brandId)->where('status', 'active'))
            ->get();

        return $this->slotIntervals($slots, $from, $to, fn (ScheduleSlot $slot) => "Regular schedule: {$slot->assignment->host->user->name} is live then.");
    }

    /**
     * The first interval overlapping [start, end), as its reason.
     *
     * @param  Collection<int, array{start: CarbonImmutable, end: CarbonImmutable, reason: string}>  $intervals
     */
    public function reasonIn(Collection $intervals, CarbonInterface $start, CarbonInterface $end): ?string
    {
        return $intervals->first(fn (array $interval) => $interval['start']->lt($end) && $interval['end']->gt($start))['reason'] ?? null;
    }

    /**
     * Occurrences of weekly slots between two moments, skipping days an event replaces the brand's schedule.
     *
     * @param  Collection<int, ScheduleSlot>  $slots
     */
    private function slotIntervals(Collection $slots, CarbonInterface $from, CarbonInterface $to, callable $reason): Collection
    {
        $intervals = collect();

        // Start a day early: an overnight slot from the day before can still be running at `$from`
        for ($day = CarbonImmutable::parse($from)->subDay()->startOfDay(); $day->lte($to); $day = $day->addDay()) {
            foreach ($slots as $slot) {
                if (! $slot->runsOn($day) || $this->events->replacing($slot->assignment->brand_id, $day)) {
                    continue;
                }

                [$slotStart, $slotEnd] = $slot->occurrenceOn($day);
                if ($slotStart->lt($to) && $slotEnd->gt($from)) {
                    $intervals->push(['start' => $slotStart, 'end' => $slotEnd, 'reason' => $reason($slot)]);
                }
            }
        }

        return $intervals;
    }
}
