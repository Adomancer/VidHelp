<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\BackupApplication;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\PointBalance;
use App\Models\PointLog;
use App\Models\User;
use App\Models\ViolationType;
use App\Models\WarningLetter;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Host points: every host starts each points period (3 months, calendar-aligned)
 * at 100; violations deduct; crossing a threshold issues an SP automatically.
 */
class PointService
{
    public function __construct(private Notifier $notifier)
    {
    }

    /**
     * The points period that contains a date, e.g. 2026-11-15 → [2026-10-01, 2026-12-31].
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    public function periodFor(CarbonInterface|string $date): array
    {
        $months = max(1, (int) config('vidhelp.points.reset_every_months'));
        $month = CarbonImmutable::parse($date)->startOfMonth();
        $start = $month->subMonths(($month->month - 1) % $months);

        return [$start, $start->addMonths($months)->subDay()];
    }

    /**
     * The host's balance for the period containing `$date` (created at the starting points).
     */
    public function balance(HostProfile $host, CarbonInterface|string|null $date = null): PointBalance
    {
        [$start, $end] = $this->periodFor($date ?? today());
        $opening = (int) config('vidhelp.points.starting_points');

        return PointBalance::firstOrCreate(
            ['host_id' => $host->id, 'period_start' => $start->toDateString()],
            ['period_end' => $end->toDateString(), 'opening_points' => $opening, 'current_points' => $opening]
        );
    }

    /**
     * Deduct a violation's points (its default, or `$points` if given).
     */
    public function deduct(
        HostProfile $host,
        ViolationType $type,
        string $source,
        ?string $reason,
        ?User $by,
        ?int $points = null,
        array $extra = [],
    ): PointLog {
        return $this->record($host, [
            ...$extra,
            'violation_type_id' => $type->id,
            'source' => $source,
            'points_change' => -abs($points ?? $type->default_points),
            'reason' => $reason,
        ], $by);
    }

    /**
     * Store a point change, update the balance and issue an SP if a threshold was crossed.
     */
    public function record(HostProfile $host, array $attributes, ?User $by = null): PointLog
    {
        return DB::transaction(function () use ($host, $attributes, $by) {
            $occurred = CarbonImmutable::parse($attributes['occurred_on'] ?? today());
            [$start] = $this->periodFor($occurred);

            $log = PointLog::create([
                ...$attributes,
                'host_id' => $host->id,
                'occurred_on' => $occurred->toDateString(),
                'period_start' => $start->toDateString(),
                'recorded_by' => $by?->id,
            ]);

            $balance = $this->recalculate($host, $start);
            $letter = $this->issueWarningIfDue($host, $balance, $log);

            if ($log->points_change < 0) {
                $this->announceDeduction($host, $log, $balance);
            }
            if ($letter) {
                $this->announceWarning($host, $letter);
            }

            return $log;
        });
    }

    /**
     * Opening points plus every counting change, kept between 0 and the opening points.
     */
    public function recalculate(HostProfile $host, CarbonInterface|string $periodStart): PointBalance
    {
        $balance = $this->balance($host, $periodStart);

        $change = (int) PointLog::counting()
            ->where('host_id', $host->id)
            ->whereDate('period_start', $balance->period_start)
            ->sum('points_change');

        $balance->update([
            'current_points' => max(0, min($balance->opening_points, $balance->opening_points + $change)),
        ]);

        return $balance;
    }

    /**
     * Cancel a log entered by mistake. SPs it triggered stay until an admin voids them too.
     */
    public function void(PointLog $log, User $by): PointBalance
    {
        if ($log->voided_at) {
            throw ValidationException::withMessages(['log' => ['Catatan ini sudah dibatalkan.']]);
        }

        $log->update(['voided_at' => now(), 'voided_by' => $by->id]);

        return $this->recalculate($log->host, $log->period_start);
    }

    /** SP level a points total has reached (0 = none). */
    public function levelFor(int $points): int
    {
        $level = 0;
        foreach (config('vidhelp.points.sp_thresholds') as $candidate => $threshold) {
            if ($points <= $threshold) {
                $level = max($level, (int) $candidate);
            }
        }

        return $level;
    }

    /**
     * Issue the highest SP the balance has reached, unless this period already has it (or higher).
     */
    private function issueWarningIfDue(HostProfile $host, PointBalance $balance, PointLog $log): ?WarningLetter
    {
        $reached = $this->levelFor($balance->current_points);
        $issued = $this->currentLevel($host, $balance->period_start);

        if ($reached <= $issued) {
            return null;
        }

        $threshold = config("vidhelp.points.sp_thresholds.{$reached}");

        return WarningLetter::create([
            'host_id' => $host->id,
            'point_log_id' => $log->id,
            'level' => $reached,
            'period_start' => $balance->period_start->toDateString(),
            'reason' => "Poin turun ke {$balance->current_points} (SP{$reached} di {$threshold} atau kurang).",
            'issued_at' => now(),
        ]);
    }

    /** Highest SP level issued (and not voided) in the period of `$date`. */
    public function currentLevel(HostProfile $host, CarbonInterface|string|null $date = null): int
    {
        [$start] = $this->periodFor($date ?? today());

        return (int) WarningLetter::counting()
            ->where('host_id', $host->id)
            ->whereDate('period_start', $start)
            ->max('level');
    }

    public function issueManual(HostProfile $host, int $level, string $reason, User $by): WarningLetter
    {
        [$start] = $this->periodFor(today());

        $letter = WarningLetter::create([
            'host_id' => $host->id,
            'level' => $level,
            'period_start' => $start->toDateString(),
            'reason' => $reason,
            'issued_by' => $by->id,
            'issued_at' => now(),
        ]);
        $this->announceWarning($host, $letter);

        return $letter;
    }

    private function announceDeduction(HostProfile $host, PointLog $log, PointBalance $balance): void
    {
        $what = $log->violationType?->name ?? 'Potongan poin';

        // The next SP level still above the host's points, e.g. "SP2 di 50 poin"
        $next = collect(config('vidhelp.points.sp_thresholds'))->filter(fn ($at) => $at < $balance->current_points)->sortDesc();

        $this->notifier->toUsers($host->user, Notice::make('points_deducted', "{$log->points_change} poin: {$what}")
            ->body(trim(($log->reason ? "{$log->reason} " : '')."Poinmu sekarang {$balance->current_points}."))
            ->field('Pelanggaran', $what)
            ->field('Perubahan', "{$log->points_change} poin")
            ->field('Poin sekarang', $balance->current_points)
            ->field('Alasan', $log->reason, inline: false)
            ->field('SP berikutnya', $next->isNotEmpty() ? "SP{$next->keys()->first()} di {$next->first()} poin" : null)
            ->link('/host/rating', 'Lihat poin'), dm: true);
    }

    private function announceWarning(HostProfile $host, WarningLetter $letter): void
    {
        $host->loadMissing('user');

        $points = $this->balance($host)->current_points;
        $notice = Notice::make('sp_issued', "Kamu mendapat SP{$letter->level}")
            ->body($letter->reason)
            ->field('Level', "SP{$letter->level}")
            ->field('Poin sekarang', $points)
            ->field('Alasan', $letter->reason, inline: false);

        $this->notifier->toUsers($host->user, (clone $notice)->link('/host/rating', 'Lihat poin dan SP'), dm: true);

        $staffNotice = $notice->as('sp_issued', "SP{$letter->level} untuk {$host->user->name}")
            ->category('admin')
            ->field('Host', $host->user->name)
            ->about($host->user)
            ->link('/admin/points', 'Lihat poin host');
        $this->notifier->toUsers($this->notifier->admins(), $staffNotice, dm: true);
        $this->notifier->toChannel('admin', $staffNotice);
    }

    public function voidWarning(WarningLetter $letter, User $by): void
    {
        if ($letter->voided_at) {
            throw ValidationException::withMessages(['letter' => ['SP ini sudah dibatalkan.']]);
        }

        $letter->update(['voided_at' => now(), 'voided_by' => $by->id]);
    }

    /**
     * A host picked to cover a backup dropped out.
     */
    public function penalizeBackupDrop(BackupApplication $application): void
    {
        if ($application->penalty_applied) {
            return;
        }

        $type = ViolationType::forCode(ViolationType::BACKUP_CANCEL);
        if ($type) {
            $request = $application->request()->with('brand')->first();
            $this->deduct(
                $application->applicant,
                $type,
                'backup_cancel',
                "Membatalkan backup di {$request->brand->name} pada {$request->start_at->translatedFormat('d M H:i')}.",
                null,
            );
        }

        $application->update(['penalty_applied' => true]);
    }

    /**
     * The host checked in late.
     */
    public function penalizeLateCheckIn(Attendance $attendance): void
    {
        $type = ViolationType::forCode(ViolationType::LATE_CHECK_IN);
        if (! $type || $attendance->late_minutes === 0) {
            return;
        }

        $attendance->loadMissing(['host', 'brand']);
        $this->deduct(
            $attendance->host,
            $type,
            'late_check_in',
            "Check-in {$attendance->late_minutes} menit setelah live {$attendance->brand->name} mulai ({$attendance->scheduled_start_at->translatedFormat('d M H:i')}).",
            null,
            extra: ['occurred_on' => $attendance->session_date->toDateString()],
        );
    }

    /**
     * Sick requests whose letter was missing or uploaded after the deadline. Runs on a schedule.
     *
     * @return int how many hosts were penalized
     */
    public function penalizeLateSickLetters(): int
    {
        $type = ViolationType::forCode(ViolationType::LATE_SICK_LETTER);
        $penalized = 0;

        $overdue = BackupRequest::query()
            ->where('reason_type', 'sick')
            ->whereIn('status', ['pending', 'open', 'filled'])
            ->where('letter_penalty_applied', false)
            ->where('start_at', '<=', now()->subHours(config('vidhelp.backup.sick_letter_grace_hours')))
            ->with(['attachments', 'requester', 'brand'])
            ->get();

        foreach ($overdue as $request) {
            $letter = $request->attachments->sortBy('created_at')->first();
            $late = ! $letter || $letter->created_at->gt($request->letter_due_at);

            if ($late && $type) {
                $this->deduct(
                    $request->requester,
                    $type,
                    'late_attachment',
                    "Surat sakit untuk {$request->brand->name} pada {$request->start_at->translatedFormat('d M')} terlambat atau tidak ada.",
                    null,
                    extra: ['occurred_on' => $request->letter_due_at->toDateString()],
                );
                $penalized++;
            }

            $request->update(['letter_penalty_applied' => true]);
        }

        return $penalized;
    }
}
