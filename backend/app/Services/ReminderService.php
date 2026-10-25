<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use Carbon\CarbonImmutable;

/**
 * Reminders before something is due, run every 5 minutes. Each one reaches a person once
 * (its key), so running often or late never repeats it. 0 in a setting turns that reminder off.
 */
class ReminderService
{
    /** A session that started this recently without a check-in gets a "you haven't checked in" nudge. */
    private const STARTED_WITHIN_MINUTES = 10;

    public function __construct(private AttendanceService $attendance, private Notifier $notifier) {}

    /** @return int how many reminders went out (one per person and thing) */
    public function send(): int
    {
        return $this->sessions() + $this->reports() + $this->sickLetters() + $this->decisions();
    }

    /**
     * Hosts with a session starting soon, or just started, that they haven't checked in for.
     */
    private function sessions(): int
    {
        $minutes = (int) config('vidhelp.notifications.live_reminder_minutes');
        if ($minutes <= 0) {
            return 0;
        }

        $now = CarbonImmutable::now();
        $sent = 0;

        $hosts = HostProfile::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->with('user.discordLink')
            ->get();

        // Everyone's sessions in one go, then the reminders already sent for them in one query
        $due = $this->attendance->sessionsForHosts($hosts, $now->subMinutes(self::STARTED_WITHIN_MINUTES), $now->addMinutes($minutes))
            ->flatMap(fn ($sessions, string $hostId) => $sessions
                ->reject(fn (array $session) => $session['role'] === 'off' || $session['attendance']
                    || CarbonImmutable::parse($session['start_at'])->lt($now->subMinutes(self::STARTED_WITHIN_MINUTES)))
                ->map(function (array $session) use ($hostId, $now) {
                    $started = CarbonImmutable::parse($session['start_at'])->lte($now);
                    $id = ($session['event_claim_id'] ?? null) ?: "{$session['slot_id']}:{$session['date']}";

                    return [...$session, 'host_id' => $hostId, 'started' => $started, 'key' => ($started ? 'no_check_in:' : 'live_soon:').$id];
                }));
        $sentBefore = $due->isEmpty() ? collect() : AppNotification::whereIn('dedupe_key', $due->pluck('key')->unique()->values())
            ->whereIn('user_id', $hosts->pluck('user_id'))
            ->get(['user_id', 'dedupe_key'])
            ->mapWithKeys(fn (AppNotification $notification) => ["{$notification->user_id}|{$notification->dedupe_key}" => true]);
        $hosts = $hosts->keyBy('id');

        foreach ($due as $session) {
            $host = $hosts[$session['host_id']];
            if ($sentBefore->has("{$host->user_id}|{$session['key']}")) {
                continue;
            }

            $start = CarbonImmutable::parse($session['start_at']);
            $started = $session['started'];
            $brand = $session['brand']['name'];

            $notice = Notice::make($started ? 'reminder_check_in' : 'reminder_live_soon', $started
                ? "Kamu belum check-in di {$brand}"
                : "Live di {$brand} mulai pukul {$start->format('H:i')}")
                ->key($session['key'])
                ->body($started
                    ? "Sesi sudah mulai pukul {$start->format('H:i')}. Check-in lebih dari ".config('vidhelp.attendance.late_after_minutes').' menit setelah mulai dihitung telat.'
                    : 'Jangan lupa check-in. Check-in dibuka '.config('vidhelp.attendance.check_in_opens_minutes').' menit sebelum mulai.')
                ->brand($brand)
                ->field('Waktu', Notice::window($start, CarbonImmutable::parse($session['end_at'])), inline: false)
                ->field('Sesi', match ($session['role']) {
                    'cover' => "Menggantikan {$session['covered_for']}",
                    'event' => "Event {$session['event_name']}",
                    default => 'Jadwal rutin',
                })
                ->link('/host/live', 'Check-in sekarang');

            $sent += $this->notifier->toUsers($host->user, $notice, dm: true);
        }

        return $sent;
    }

    /** Check-ins whose live report is due soon and not sent yet. */
    private function reports(): int
    {
        $hours = (int) config('vidhelp.notifications.deadline_reminder_hours');
        if ($hours <= 0) {
            return 0;
        }

        $due = Attendance::query()
            ->whereDoesntHave('report')
            ->whereBetween('report_due_at', [now(), now()->addHours($hours)])
            ->with(['host.user.discordLink', 'brand'])
            ->get();

        $sent = 0;
        foreach ($due as $attendance) {
            $sent += $this->notifier->toUsers($attendance->host->user, Notice::make('reminder_report_due', "Laporan live {$attendance->brand->name} belum dikirim")
                ->key("report_due:{$attendance->id}")
                ->body("Kirim sebelum {$attendance->report_due_at->translatedFormat('D j M H:i')}. Laporan yang terlambat ditandai dan dicek admin.")
                ->brand($attendance->brand->name)
                ->field('Sesi', Notice::window($attendance->scheduled_start_at, $attendance->scheduled_end_at), inline: false)
                ->field('Batas kirim', Notice::time($attendance->report_due_at), inline: false)
                ->link('/host/live', 'Kirim laporan'), dm: true);
        }

        return $sent;
    }

    /** Sick requests whose doctor's letter is due soon and not uploaded yet. */
    private function sickLetters(): int
    {
        $hours = (int) config('vidhelp.notifications.deadline_reminder_hours');
        if ($hours <= 0) {
            return 0;
        }

        // letter_due_at = start_at + grace hours
        $grace = (int) config('vidhelp.backup.sick_letter_grace_hours');
        $due = BackupRequest::query()
            ->where('reason_type', 'sick')
            ->whereIn('status', ['pending', 'open', 'filled'])
            ->whereNull('letter_uploaded_at')
            ->whereDoesntHave('attachments')
            ->whereBetween('start_at', [now()->subHours($grace), now()->subHours($grace)->addHours($hours)])
            ->with(['requester.user.discordLink', 'brand'])
            ->get();

        $sent = 0;
        foreach ($due as $request) {
            $sent += $this->notifier->toUsers($request->requester->user, Notice::make('reminder_sick_letter', "Surat sakit untuk {$request->brand->name} belum diunggah")
                ->key("sick_letter:{$request->id}")
                ->body("Unggah sebelum {$request->letter_due_at->translatedFormat('D j M H:i')}. Kalau terlambat, poinmu dipotong dan kamu membayar penggantimu sendiri.")
                ->brand($request->brand->name)
                ->field('Sesi', Notice::window($request->start_at, $request->end_at), inline: false)
                ->field('Batas unggah', Notice::time($request->letter_due_at), inline: false)
                ->link('/host/backups', 'Unggah surat'), dm: true);
        }

        return $sent;
    }

    /** Backups with applicants nobody decided on, about to be filled automatically. */
    private function decisions(): int
    {
        $minutes = (int) config('vidhelp.notifications.decision_reminder_minutes');
        if ($minutes <= 0) {
            return 0;
        }

        $due = BackupRequest::query()
            ->where('status', 'pending')
            ->whereBetween('auto_fill_at', [now(), now()->addMinutes($minutes)])
            ->withCount(['applications' => fn ($q) => $q->where('status', 'applied')])
            ->with(['requester.user', 'brand'])
            ->get();
        if ($due->isEmpty()) {
            return 0;
        }

        $staff = $this->notifier->staff();
        $sent = 0;
        foreach ($due as $request) {
            $notice = Notice::make('backup_decision_due', "Pendaftar backup {$request->requester->user->name} belum diputuskan")
                ->key("decision_due:{$request->id}")
                ->body("{$request->brand->name}: {$request->applications_count} pendaftar menunggu. Yang terbaik dipilih otomatis pukul {$request->auto_fill_at->format('H:i')}.")
                ->brand($request->brand->name)
                ->field('Waktu', Notice::window($request->start_at, $request->end_at), inline: false)
                ->field('Untuk', $request->requester->user->name)
                ->field('Pendaftar', $request->applications_count)
                ->field('Dipilih otomatis', Notice::time($request->auto_fill_at), inline: false)
                ->link('/operator/backups', 'Putuskan sekarang');

            $sent += $this->notifier->toUsers($staff, $notice, dm: true);
            $this->notifier->toChannel('admin', $notice);
        }

        return $sent;
    }
}
