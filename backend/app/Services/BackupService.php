<?php

namespace App\Services;

use App\Models\BackupApplication;
use App\Models\BackupQuota;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Backup rules: who may cover a request, picking a host, dropping out, and
 * the automatic steps for when no admin is standing by.
 */
class BackupService
{
    public function __construct(
        private PointService $points,
        private HostCalendar $calendar,
        private EventCalendar $events,
    ) {
    }

    /**
     * Open a request for a host's slot on a date. Requests made by admin/operator
     * are approved straight away; host requests wait for approval (or auto-open).
     */
    public function create(ScheduleSlot $slot, string $date, array $reason, User $by, bool $approved): BackupRequest
    {
        $day = CarbonImmutable::parse($date)->startOfDay();

        if (! $slot->runsOn($day)) {
            throw ValidationException::withMessages(['backup_date' => ['That slot is not scheduled on this date.']]);
        }
        if ($event = $this->events->replacing($slot->assignment->brand_id, $day)) {
            throw ValidationException::withMessages(['backup_date' => ["That day the regular schedule is replaced by {$event->name}."]]);
        }

        [$start, $end] = $slot->occurrenceOn($day);

        if ($end->isPast()) {
            throw ValidationException::withMessages(['backup_date' => ['That slot has already finished.']]);
        }

        $duplicate = BackupRequest::where('slot_id', $slot->id)
            ->whereDate('backup_date', $day)
            ->whereIn('status', ['pending', 'open', 'filled'])
            ->exists();
        if ($duplicate) {
            throw ValidationException::withMessages(['backup_date' => ['A backup is already requested for this slot on that date.']]);
        }

        return BackupRequest::create([
            ...$reason,
            'slot_id' => $slot->id,
            'brand_id' => $slot->assignment->brand_id,
            'requesting_host_id' => $slot->assignment->host_id,
            'created_by' => $by->id,
            'backup_date' => $day->toDateString(),
            'start_at' => $start,
            'end_at' => $end,
            'status' => $approved ? 'open' : 'pending',
            'approved_by' => $approved ? $by->id : null,
            'approved_at' => $approved ? now() : null,
            'auto_open_at' => $approved ? null : now()->addMinutes(config('vidhelp.backup.auto_open_after_minutes')),
            'auto_fill_at' => $start->subMinutes(config('vidhelp.backup.auto_fill_before_minutes')),
        ]);
    }

    /**
     * Why a host can't cover this request, or null if they can.
     */
    public function ineligibleReason(HostProfile $host, BackupRequest $request): ?string
    {
        if ($host->id === $request->requesting_host_id) {
            return 'This is your own request.';
        }

        if ($host->status !== 'active' || $host->user->status !== 'active') {
            return 'This host is not active.';
        }

        if ($busy = $this->busyReason($host, $request->start_at, $request->end_at, $request)) {
            return $busy;
        }

        if (! $this->isSameBrand($host, $request)) {
            $quota = BackupQuota::peek($host->id, $request->quotaMonth());
            if ($quota->isFull()) {
                return "Monthly cross-brand backup quota used ({$quota->quota_used}/{$quota->quota_max}).";
            }
        }

        return null;
    }

    /**
     * What keeps the host busy between start and end: their own slot, another cover or an event block.
     */
    public function busyReason(HostProfile $host, CarbonInterface $start, CarbonInterface $end, ?BackupRequest $except = null): ?string
    {
        return $this->calendar->busyReason($host, $start, $end, exceptBackupId: $except?->getKey());
    }

    public function isSameBrand(HostProfile $host, BackupRequest $request): bool
    {
        return $host->assignments()->where('brand_id', $request->brand_id)->where('status', 'active')->exists();
    }

    /**
     * Applicants in pick order: best latest rating first, then same brand, then earliest to apply.
     *
     * @return Collection<int, BackupApplication>
     */
    public function rankedApplicants(BackupRequest $request): Collection
    {
        // Unrated hosts rank below every rated one
        $rating = fn (BackupApplication $application) => $application->applicant->latestRating?->rating ?? -1;

        return $request->applications()
            ->with(['applicant.user', 'applicant.latestRating'])
            ->where('status', 'applied')
            ->get()
            ->sortBy([
                fn (BackupApplication $a, BackupApplication $b) => $rating($b) <=> $rating($a),
                fn (BackupApplication $a, BackupApplication $b) => $this->isSameBrand($b->applicant, $request) <=> $this->isSameBrand($a->applicant, $request),
                fn (BackupApplication $a, BackupApplication $b) => $a->created_at <=> $b->created_at,
            ])
            ->values();
    }

    /**
     * Make `host` the cover. They don't need to have applied (admin can assign directly).
     */
    public function fill(BackupRequest $request, HostProfile $host, bool $auto = false): BackupRequest
    {
        return DB::transaction(function () use ($request, $host, $auto) {
            $request = BackupRequest::lockForUpdate()->findOrFail($request->id);

            if ($request->status !== 'open') {
                throw ValidationException::withMessages(['host_id' => ['This backup is not open.']]);
            }
            if ($reason = $this->ineligibleReason($host, $request)) {
                throw ValidationException::withMessages(['host_id' => [$reason]]);
            }

            $crossBrand = ! $this->isSameBrand($host, $request);
            if ($crossBrand) {
                BackupQuota::for($host->id, $request->quotaMonth())->increment('quota_used');
            }

            $request->applications()->updateOrCreate(
                ['applicant_host_id' => $host->id],
                ['status' => 'approved', 'decided_at' => now()]
            );

            $request->update([
                'status' => 'filled',
                'filled_by_host_id' => $host->id,
                'filled_at' => now(),
                'auto_filled' => $auto,
                'counts_toward_quota' => $crossBrand,
            ]);

            return $request;
        });
    }

    /**
     * Undo a fill: the cover's application becomes `$applicationStatus`
     * ("cancelled" = they dropped out → penalty), quota is refunded, request reopens.
     */
    public function unfill(BackupRequest $request, string $applicationStatus): void
    {
        DB::transaction(function () use ($request, $applicationStatus) {
            if ($request->counts_toward_quota) {
                BackupQuota::for($request->filled_by_host_id, $request->quotaMonth())->decrement('quota_used');
            }

            $cover = $request->applications()->where('applicant_host_id', $request->filled_by_host_id)->first();
            $cover?->update(['status' => $applicationStatus, 'decided_at' => now()]);

            // The cover dropped out after being picked: point penalty
            if ($cover && $applicationStatus === 'cancelled') {
                $this->points->penalizeBackupDrop($cover);
            }

            $request->update([
                'status' => 'open',
                'filled_by_host_id' => null,
                'filled_at' => null,
                'auto_filled' => false,
                'counts_toward_quota' => false,
            ]);
        });
    }

    /**
     * Close a request (rejected/cancelled): release a cover and turn down applicants.
     */
    public function close(BackupRequest $request, string $status): void
    {
        DB::transaction(function () use ($request, $status) {
            if ($request->status === 'filled') {
                $this->unfill($request, 'rejected');
            }

            $request->applications()->where('status', 'applied')->update(['status' => 'rejected', 'decided_at' => now()]);
            $request->update(['status' => $status, 'cancelled_at' => $status === 'cancelled' ? now() : null]);
        });
    }

    /**
     * Scheduled every minute: open requests nobody reviewed, and pick the best
     * applicant for open requests about to start.
     *
     * @return array{opened: int, filled: int}
     */
    public function autoProcess(): array
    {
        $opened = BackupRequest::where('status', 'pending')
            ->where('auto_open_at', '<=', now())
            ->where('end_at', '>', now())
            ->update(['status' => 'open', 'auto_approved' => true, 'approved_at' => now()]);

        $filled = 0;
        $due = BackupRequest::where('status', 'open')
            ->where('auto_fill_at', '<=', now())
            ->where('end_at', '>', now())
            ->get();

        foreach ($due as $request) {
            foreach ($this->rankedApplicants($request) as $application) {
                try {
                    $this->fill($request, $application->applicant, auto: true);
                    $filled++;
                    break;
                } catch (ValidationException) {
                    continue; // e.g. became busy or quota full since applying
                }
            }
        }

        return ['opened' => $opened, 'filled' => $filled];
    }
}
