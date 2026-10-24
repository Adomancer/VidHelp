<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\EventSlotClaim;
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
    public function __construct(private EventCalendar $events, private PayrollService $payroll, private PointService $points, private Notifier $notifier) {}

    /**
     * The host's session occurrences between two moments: their own slots (minus ones
     * someone else covers or an event replaces), backups they cover and event blocks
     * they claimed. Each with its attendance/report.
     *
     * @return Collection<int, array>
     */
    public function sessions(HostProfile $host, CarbonInterface $from, CarbonInterface $to): Collection
    {
        $slots = ScheduleSlot::query()
            ->with('assignment.brand:id,name')
            // From the day before: an overnight slot from then can still be running at `$from`
            ->activeDuring(CarbonImmutable::parse($from)->subDay()->toDateString(), CarbonImmutable::parse($to)->toDateString())
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id)->where('status', 'active'))
            ->get();

        // My occurrences in this window that another host covers
        $coveredByOthers = BackupRequest::where('requesting_host_id', $host->id)
            ->where('status', 'filled')
            ->where('end_at', '>', $from)
            ->where('start_at', '<', $to)
            ->with('filler.user')
            ->get()
            ->keyBy(fn (BackupRequest $backup) => $backup->slot_id.'|'.$backup->backup_date->toDateString());

        $attendances = Attendance::where('host_id', $host->id)
            ->where('scheduled_end_at', '>', $from->copy()->subDay())
            ->with('report')
            ->get()
            ->keyBy(fn (Attendance $attendance) => $this->attendanceKey($attendance));

        $sessions = collect();

        for ($day = CarbonImmutable::parse($from)->subDay()->startOfDay(); $day->lte($to); $day = $day->addDay()) {
            foreach ($slots as $slot) {
                if (! $slot->runsOn($day) || $this->events->replacing($slot->assignment->brand_id, $day)) {
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

        $claims = EventSlotClaim::active()
            ->where('host_id', $host->id)
            ->where('end_at', '>', $from)
            ->where('start_at', '<', $to)
            ->with('event.brand:id,name')
            ->get();

        foreach ($claims as $claim) {
            $sessions->push([
                'slot_id' => null,
                'date' => $claim->start_at->toDateString(),
                'backup_request_id' => null,
                'event_claim_id' => $claim->id,
                'event_name' => $claim->event->name,
                'brand' => $claim->event->brand->only('id', 'name'),
                'start_at' => $claim->start_at,
                'end_at' => $claim->end_at,
                'role' => 'event',
                'attendance' => $attendances->get('event|'.$claim->id),
            ]);
        }

        return $sessions->sortBy('start_at')->values();
    }

    private function attendanceKey(Attendance $attendance): string
    {
        return $attendance->event_claim_id
            ? 'event|'.$attendance->event_claim_id
            : $attendance->slot_id.'|'.$attendance->session_date->toDateString();
    }

    /**
     * Check in for my own slot occurrence, a backup I'm covering, or an event block I claimed.
     * More than the late limit after the start deducts the "Telat" violation.
     */
    public function checkIn(HostProfile $host, ?string $slotId, ?string $date, ?string $backupRequestId, ?string $eventClaimId = null): Attendance
    {
        if ($eventClaimId) {
            $claim = EventSlotClaim::active()
                ->whereKey($eventClaimId)
                ->where('host_id', $host->id)
                ->with('event')
                ->first() ?? throw ValidationException::withMessages(['session' => ['Blok event ini bukan milikmu.']]);

            [$slotId, $brandId, $date, $start, $end] = [
                null, $claim->event->brand_id, $claim->start_at->toDateString(), $claim->start_at, $claim->end_at,
            ];
        } elseif ($backupRequestId) {
            $backup = BackupRequest::whereKey($backupRequestId)
                ->where('filled_by_host_id', $host->id)
                ->where('status', 'filled')
                ->first() ?? throw ValidationException::withMessages(['session' => ['Kamu tidak menggantikan di backup ini.']]);

            [$slotId, $brandId, $date, $start, $end] = [
                $backup->slot_id, $backup->brand_id, $backup->backup_date->toDateString(), $backup->start_at, $backup->end_at,
            ];
        } else {
            $slot = ScheduleSlot::whereKey($slotId)
                ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id)->where('status', 'active'))
                ->with('assignment')
                ->first() ?? throw ValidationException::withMessages(['session' => ['Ini bukan salah satu sesimu.']]);

            $day = CarbonImmutable::parse($date);
            if (! $slot->runsOn($day)) {
                throw ValidationException::withMessages(['session' => ['Sesi itu tidak terjadwal di tanggal ini.']]);
            }
            if ($event = $this->events->replacing($slot->assignment->brand_id, $day)) {
                throw ValidationException::withMessages(['session' => ["Di hari itu {$event->name} menggantikan jadwal reguler; check-in di blok event kamu saja."]]);
            }

            $cover = BackupRequest::where('slot_id', $slot->id)->whereDate('backup_date', $day)->where('status', 'filled')->with('filler.user')->first();
            if ($cover) {
                throw ValidationException::withMessages(['session' => ["Kamu libur di sesi ini; {$cover->filler->user->name} yang menggantikan."]]);
            }

            [$start, $end] = $slot->occurrenceOn($day);
            $brandId = $slot->assignment->brand_id;
        }

        $opensAt = $start->copy()->subMinutes(config('vidhelp.attendance.check_in_opens_minutes'));
        if (now()->lt($opensAt)) {
            throw ValidationException::withMessages(['session' => ['Check-in dibuka jam '.$opensAt->format('H:i').'.']]);
        }
        if (now()->gte($end)) {
            throw ValidationException::withMessages(['session' => ['Sesi ini sudah selesai.']]);
        }

        $existing = $eventClaimId
            ? Attendance::where('event_claim_id', $eventClaimId)->exists()
            : Attendance::where('host_id', $host->id)->where('slot_id', $slotId)->whereDate('session_date', $date)->exists();
        if ($existing) {
            throw ValidationException::withMessages(['session' => ['Kamu sudah check-in untuk sesi ini.']]);
        }

        $attendance = Attendance::create([
            'host_id' => $host->id,
            'slot_id' => $slotId,
            'backup_request_id' => $backupRequestId,
            'event_claim_id' => $eventClaimId,
            'brand_id' => $brandId,
            'session_date' => $date,
            'scheduled_start_at' => $start,
            'scheduled_end_at' => $end,
            'check_in_at' => now(),
            'report_due_at' => now()->addHours(config('vidhelp.attendance.report_due_hours')),
        ]);

        $this->points->penalizeLateCheckIn($attendance);

        return $attendance;
    }

    public function checkOut(Attendance $attendance): Attendance
    {
        if ($attendance->check_out_at) {
            throw ValidationException::withMessages(['session' => ['Kamu sudah check-out.']]);
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
            throw ValidationException::withMessages(['report' => ['Laporan ini sudah '.($report->status === 'approved' ? 'disetujui' : 'ditolak').'.']]);
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
                $this->announceFlagged($report, $attendance);
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
            throw ValidationException::withMessages(['report' => ['Laporan ini sudah disetujui.']]);
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
            throw ValidationException::withMessages(['report' => ['Laporan yang sudah disetujui tidak bisa ditolak.']]);
        }

        $report->update(['status' => 'rejected', 'reviewed_by' => $by->id, 'reviewed_at' => now(), 'review_note' => $note]);

        $attendance = $report->attendance;
        $this->notifier->toUsers($report->host->user, Notice::make('report_rejected', 'Laporan live kamu ditolak')
            ->body("{$report->brand->name}, {$attendance->scheduled_start_at->translatedFormat('D j M H:i')}: {$note}")
            ->brand($report->brand->name)
            ->field('Sesi', Notice::window($attendance->scheduled_start_at, $attendance->scheduled_end_at), inline: false)
            ->field('Durasi dilaporkan', $this->hoursLabel($report->duration_hours))
            ->field('Ditolak oleh', $by->name)
            ->field('Catatan', $note, inline: false)
            ->link('/host/live', 'Buka laporan'), dm: true);

        return $report;
    }

    private function createWorkSession(LiveReport $report, Attendance $attendance, float $hours): WorkSession
    {
        $checkedOut = $attendance->check_out_at !== null;

        $session = $report->workSession()->create([
            'host_id' => $attendance->host_id,
            'brand_id' => $attendance->brand_id,
            'session_date' => $attendance->session_date,
            'start_at' => $checkedOut ? $attendance->check_in_at : $attendance->scheduled_start_at,
            'end_at' => $checkedOut ? $attendance->check_out_at : $attendance->scheduled_end_at,
            'duration_hours' => $hours,
            'session_type' => match (true) {
                $attendance->event_claim_id !== null => 'event',
                $attendance->backup_request_id !== null => 'backup',
                default => 'regular',
            },
            'notes' => $report->review_note,
        ]);

        $this->payroll->assign($session);

        return $session;
    }

    /** A report needs a human decision. */
    private function announceFlagged(LiveReport $report, Attendance $attendance): void
    {
        $labels = [
            'late_report' => 'dikirim terlambat',
            'no_check_out' => 'tidak check-out',
            'more_than_scheduled' => 'waktu lebih lama dari jadwal',
            'less_than_scheduled' => 'waktu lebih singkat dari jadwal',
            'more_than_attended' => 'waktu lebih lama dari check-in',
        ];
        $reasons = array_map(fn (string $reason) => $labels[$reason] ?? $reason, $report->flag_reasons ?? []);

        $attendance->loadMissing(['host.user', 'brand']);
        $host = $attendance->host->user;

        $notice = Notice::make('report_flagged', "Laporan perlu dicek: {$host->name}")
            ->body("{$attendance->brand->name}, {$attendance->scheduled_start_at->translatedFormat('D j M H:i')}: ".implode(', ', $reasons).'.')
            ->brand($attendance->brand->name)
            ->field('Host', $host->name)
            ->field('Durasi dilaporkan', $this->hoursLabel($report->duration_hours))
            ->field('Sesi', Notice::window($attendance->scheduled_start_at, $attendance->scheduled_end_at), inline: false)
            ->field('Check-in', $attendance->check_in_at->format('H:i'))
            ->field('Check-out', $attendance->check_out_at?->format('H:i') ?? 'Tidak check-out')
            ->field('Alasan', implode('
', array_map(fn (string $reason) => "• {$reason}", $reasons)), inline: false)
            ->about($host)
            ->link('/operator/reports', 'Cek laporan');

        $this->notifier->toUsers($this->notifier->staff(), $notice, dm: true);
        $this->notifier->toChannel('admin', $notice);
    }

    /** "2,5 jam" */
    private function hoursLabel(float|string $hours): string
    {
        return rtrim(rtrim(number_format((float) $hours, 2, ',', '.'), '0'), ',').' jam';
    }
}
