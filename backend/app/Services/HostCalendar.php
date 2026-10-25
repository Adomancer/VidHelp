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
    public function __construct(private EventCalendar $events) {}

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
        return $this->hostsIntervals([$host->id], $from, $to)
            ->get($host->id)
            ->reject(fn (array $interval) => ($exceptBackupId !== null && ($interval['backup_id'] ?? null) === $exceptBackupId)
                || ($exceptClaimId !== null && ($interval['claim_id'] ?? null) === $exceptClaimId))
            ->values();
    }

    /**
     * The same for several hosts in three queries, by host id: their slots, the backups they
     * cover (with `backup_id`) and their event blocks (with `claim_id`).
     *
     * @param  list<string>  $hostIds
     * @return Collection<string, Collection<int, array{start: CarbonImmutable, end: CarbonImmutable, reason: string}>>
     */
    public function hostsIntervals(array $hostIds, CarbonInterface $from, CarbonInterface $to): Collection
    {
        $byHost = collect($hostIds)->mapWithKeys(fn (string $id) => [$id => collect()]);
        if ($hostIds === []) {
            return $byHost;
        }

        ScheduleSlot::query()
            ->with('assignment.brand:id,name')
            ->activeDuring(...$this->slotDays($from, $to))
            ->whereHas('assignment', fn ($q) => $q->whereIn('host_id', $hostIds)->where('status', 'active'))
            ->get()
            ->groupBy(fn (ScheduleSlot $slot) => $slot->assignment->host_id)
            ->each(fn (Collection $slots, string $hostId) => $byHost->put($hostId, $this->slotIntervals(
                $slots, $from, $to, fn (ScheduleSlot $slot) => "Live di {$slot->assignment->brand->name} ({$slot->label()})."
            )));

        BackupRequest::query()
            ->with('brand:id,name')
            ->where('status', 'filled')
            ->whereIn('filled_by_host_id', $hostIds)
            ->where('start_at', '<', $to)
            ->where('end_at', '>', $from)
            ->get()
            ->each(fn (BackupRequest $cover) => $byHost->get($cover->filled_by_host_id)->push([
                'start' => CarbonImmutable::parse($cover->start_at),
                'end' => CarbonImmutable::parse($cover->end_at),
                'reason' => "Sudah menggantikan di {$cover->brand->name} pada waktu itu.",
                'backup_id' => $cover->id,
            ]));

        EventSlotClaim::active()
            ->with('event:id,name')
            ->whereIn('host_id', $hostIds)
            ->where('start_at', '<', $to)
            ->where('end_at', '>', $from)
            ->get()
            ->each(fn (EventSlotClaim $claim) => $byHost->get($claim->host_id)->push([
                'start' => CarbonImmutable::parse($claim->start_at),
                'end' => CarbonImmutable::parse($claim->end_at),
                'reason' => "Sudah mengambil blok {$claim->event->name} pada waktu itu.",
                'claim_id' => $claim->id,
            ]));

        return $byHost;
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
            ->activeDuring(...$this->slotDays($from, $to))
            ->whereHas('assignment', fn ($q) => $q->where('brand_id', $brandId)->where('status', 'active'))
            ->get();

        return $this->slotIntervals($slots, $from, $to, fn (ScheduleSlot $slot) => "Jadwal reguler: {$slot->assignment->host->user->name} sedang live di waktu itu.");
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
     * The days whose slots can run between two moments, for ScheduleSlot::activeDuring(): from the
     * day before (an overnight slot from then can still be running at `$from`).
     *
     * @return array{0: string, 1: string}
     */
    private function slotDays(CarbonInterface $from, CarbonInterface $to): array
    {
        return [CarbonImmutable::parse($from)->subDay()->toDateString(), CarbonImmutable::parse($to)->toDateString()];
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
