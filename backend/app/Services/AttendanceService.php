<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\LiveReport;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\WorkSession;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Check-in/out, live reports, and turning reports into paid work sessions.
 */
class AttendanceService
{
    /**
     * The host's session occurrences between two moments: their own slots (minus ones
     * someone else covers) plus backups they cover. Each with its attendance/report.
     *
     * @return Collection<int, array>
     */
    public function sessions(HostProfile $host, CarbonInterface $from, CarbonInterface $to): Collection
    {
        $slots = ScheduleSlot::query()
            ->with('assignment.brand:id,name')
            ->where('status', 'active')
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id)->where('status', 'active'))
            ->get();

        // My occurrences that another host covers
        $coveredByOthers = BackupRequest::where('requesting_host_id', $host->id)
            ->where('status', 'filled')
            ->with('filler.user')
            ->get()
            ->keyBy(fn (BackupRequest $backup) => $backup->slot_id.'|'.$backup->backup_date->toDateString());

        $attendances = Attendance::where('host_id', $host->id)
            ->where('scheduled_end_at', '>', $from->copy()->subDay())
            ->with('report')
            ->get()
            ->keyBy(fn (Attendance $attendance) => $attendance->slot_id.'|'.$attendance->session_date->toDateString());

        $sessions = collect();

        for ($day = CarbonImmutable::parse($from)->subDay()->startOfDay(); $day->lte($to); $day = $day->addDay()) {
            foreach ($slots as $slot) {
                if (! $slot->runsOn($day)) {
                    continue;
                }

                [$start, $end] = $slot->occurrenceOn($day);
                if ($end->lte($from) || $start->gte($to)) {
                    continue;
                }

                $key = $slot->id.'|'.$day->toDateString();
                $cover = $coveredByOthers->get($key);

                $sessions->push([
                    'slot_id' => $slot->id,
                    'date' => $day->toDateString(),
                    'backup_request_id' => null,
                    'brand' => $slot->assignment->brand->only('id', 'name'),
                    'start_at' => $start,
                    'end_at' => $end,
                    'role' => $cover ? 'off' : 'own',
                    'covered_by' => $cover?->filler?->user->name,
                    'attendance' => $attendances->get($key),
                ]);
            }
        }

        $covers = BackupRequest::where('filled_by_host_id', $host->id)
            ->where('status', 'filled')
            ->where('end_at', '>', $from)
            ->where('start_at', '<', $to)
            ->with(['brand:id,name', 'requester.user'])
            ->get();

        foreach ($covers as $backup) {
            $sessions->push([
                'slot_id' => $backup->slot_id,
                'date' => $backup->backup_date->toDateString(),
                'backup_request_id' => $backup->id,
                'brand' => $backup->brand->only('id', 'name'),
                'start_at' => $backup->start_at,
                'end_at' => $backup->end_at,
                'role' => 'cover',
                'covered_for' => $backup->requester->user->name,
                'attendance' => $attendances->get($backup->slot_id.'|'.$backup->backup_date->toDateString()),
            ]);
        }

        return $sessions->sortBy('start_at')->values();
    }

    /**
     * Check in for my own slot occurrence, or for a backup I'm covering.
     */
    public function checkIn(HostProfile $host, string $slotId, string $date, ?string $backupRequestId): Attendance
    {
        if ($backupRequestId) {
            $backup = BackupRequest::whereKey($backupRequestId)
                ->where('filled_by_host_id', $host->id)
                ->where('status', 'filled')
                ->first() ?? throw ValidationException::withMessages(['session' => ['You are not covering this backup.']]);

            [$slotId, $brandId, $date, $start, $end] = [
                $backup->slot_id, $backup->brand_id, $backup->backup_date->toDateString(), $backup->start_at, $backup->end_at,
            ];
        } else {
            $slot = ScheduleSlot::whereKey($slotId)
                ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id)->where('status', 'active'))
                ->with('assignment')
                ->first() ?? throw ValidationException::withMessages(['session' => ['This is not one of your sessions.']]);

            $day = CarbonImmutable::parse($date);
            if (! $slot->runsOn($day)) {
                throw ValidationException::withMessages(['session' => ['That session is not scheduled on this date.']]);
            }

            $cover = BackupRequest::where('slot_id', $slot->id)->whereDate('backup_date', $day)->where('status', 'filled')->with('filler.user')->first();
            if ($cover) {
                throw ValidationException::withMessages(['session' => ["You're off for this session; {$cover->filler->user->name} covers it."]]);
            }

            [$start, $end] = $slot->occurrenceOn($day);
            $brandId = $slot->assignment->brand_id;
        }

        $opensAt = $start->copy()->subMinutes(config('vidhelp.attendance.check_in_opens_minutes'));
        if (now()->lt($opensAt)) {
            throw ValidationException::withMessages(['session' => ['Check-in opens at '.$opensAt->format('H:i').'.']]);
        }
        if (now()->gte($end)) {
            throw ValidationException::withMessages(['session' => ['This session has already ended.']]);
        }

        $existing = Attendance::where('host_id', $host->id)->where('slot_id', $slotId)->whereDate('session_date', $date)->exists();
        if ($existing) {
            throw ValidationException::withMessages(['session' => ['You already checked in for this session.']]);
        }

        return Attendance::create([
            'host_id' => $host->id,
            'slot_id' => $slotId,
            'backup_request_id' => $backupRequestId,
            'brand_id' => $brandId,
            'session_date' => $date,
            'scheduled_start_at' => $start,
            'scheduled_end_at' => $end,
            'check_in_at' => now(),
            'report_due_at' => now()->addHours(config('vidhelp.attendance.report_due_hours')),
        ]);
    }

    public function checkOut(Attendance $attendance): Attendance
    {
        if ($attendance->check_out_at) {
            throw ValidationException::withMessages(['session' => ['You already checked out.']]);
        }

        $attendance->update(['check_out_at' => now()]);

        return $attendance;
    }

    /**
     * Save (or resubmit a flagged) report, then auto-approve it if it checks out.
     */
    public function submitReport(Attendance $attendance, array $data): LiveReport
    {
        $report = $attendance->report;

        if ($report && in_array($report->status, ['approved', 'rejected'])) {
            throw ValidationException::withMessages(['report' => ["This report was already {$report->status}."]]);
        }

        return DB::transaction(function () use ($attendance, $report, $data) {
            $report ??= new LiveReport([
                'attendance_id' => $attendance->id,
                'host_id' => $attendance->host_id,
                'brand_id' => $attendance->brand_id,
            ]);

            $report->fill([
                ...$data,
                'submitted_at' => now(),
                // A late first submission stays late when resubmitted
                'flag_reasons' => $report->exists && in_array('late_report', $report->flag_reasons ?? []) ? ['late_report'] : [],
            ]);

            $reasons = $this->flagReasons($attendance, $report);
            $report->flag_reasons = $reasons;

            if ($reasons === []) {
                $report->fill(['status' => 'approved', 'reviewed_by' => null, 'reviewed_at' => now()])->save();
                $this->createWorkSession($report, $attendance, $report->duration_hours);
            } else {
                $report->fill(['status' => 'flagged'])->save();
            }

            return $report;
        });
    }

    /**
     * Reasons a report can't be auto-approved (empty = fine).
     *
     * @return list<string>
     */
    public function flagReasons(Attendance $attendance, LiveReport $report): array
    {
        $reasons = $report->flag_reasons ?? [];

        // Compare whole minutes: 20 min is stored as 0.33 h and must still equal a 20-min slot
        $tolerance = config('vidhelp.attendance.duration_tolerance_minutes');
        $reported = (int) round($report->duration_hours * 60);
        $scheduled = (int) $attendance->scheduled_start_at->diffInMinutes($attendance->scheduled_end_at);

        if ($report->submitted_at->gt($attendance->report_due_at)) {
            $reasons[] = 'late_report';
        }
        if (! $attendance->check_out_at) {
            $reasons[] = 'no_check_out';
        }
        if ($reported > $scheduled) {
            $reasons[] = 'more_than_scheduled';
        } elseif ($reported < $scheduled - $tolerance) {
            $reasons[] = 'less_than_scheduled';
        }
        if ($attendance->check_out_at && $reported > (int) $attendance->check_in_at->diffInMinutes($attendance->check_out_at) + $tolerance) {
            $reasons[] = 'more_than_attended';
        }

        return array_values(array_unique($reasons));
    }

    /**
     * Operator/admin accepts a flagged report, optionally with corrected hours.
     */
    public function approve(LiveReport $report, User $by, float $hours, ?string $note): LiveReport
    {
        if ($report->status === 'approved') {
            throw ValidationException::withMessages(['report' => ['This report is already approved.']]);
        }

        return DB::transaction(function () use ($report, $by, $hours, $note) {
            $report->update(['status' => 'approved', 'reviewed_by' => $by->id, 'reviewed_at' => now(), 'review_note' => $note]);
            $this->createWorkSession($report, $report->attendance, $hours);

            return $report;
        });
    }

    public function reject(LiveReport $report, User $by, string $note): LiveReport
    {
        if ($report->status === 'approved') {
            throw ValidationException::withMessages(['report' => ['An approved report cannot be rejected.']]);
        }

        $report->update(['status' => 'rejected', 'reviewed_by' => $by->id, 'reviewed_at' => now(), 'review_note' => $note]);

        return $report;
    }

    private function createWorkSession(LiveReport $report, Attendance $attendance, float $hours): WorkSession
    {
        $checkedOut = $attendance->check_out_at !== null;

        return $report->workSession()->create([
            'host_id' => $attendance->host_id,
            'brand_id' => $attendance->brand_id,
            'session_date' => $attendance->session_date,
            'start_at' => $checkedOut ? $attendance->check_in_at : $attendance->scheduled_start_at,
            'end_at' => $checkedOut ? $attendance->check_out_at : $attendance->scheduled_end_at,
            'duration_hours' => $hours,
            'session_type' => $attendance->backup_request_id ? 'backup' : 'regular',
            'notes' => $report->review_note,
        ]);
    }
}
