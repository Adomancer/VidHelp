<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostProfile;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\PointBalance;
use App\Models\User;
use App\Models\WarningLetter;
use App\Models\WorkSession;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Figures for the dashboards: what needs attention, today's sessions, brand progress this period,
 * and a host's own week, to-dos, pay and score.
 */
class DashboardService
{
    public const HOURS_CHART_DAYS = 14;

    /** The dashboard lists at most this many backups; the backup desk has the rest. */
    public const BACKUP_ROWS = 20;

    /** The host dashboard lists sessions for today and the days after it, this many days in all. */
    public const HOST_SCHEDULE_DAYS = 7;

    public function __construct(
        private AttendanceService $attendance,
        private BackupService $backups,
        private PayrollService $payroll,
        private PointService $points,
    ) {}

    public function admin(): array
    {
        return [
            'attention' => $this->attention(),
            'today' => $this->today(),
            'backups' => $this->backupNeeds(),
            'brands' => $this->brands(),
            'hours_by_day' => $this->hoursByDay(),
            'people' => $this->people(),
        ];
    }

    /**
     * A host's overview: their sessions this week, what they still have to do, backups they could
     * take, pay so far, points and rating, and their approved hours of the last two weeks.
     */
    public function host(HostProfile $host): array
    {
        return [
            'sessions' => $this->hostSessions($host),
            'attention' => $this->hostAttention($host),
            'cover_chances' => $this->coverChances($host),
            'pay' => [
                'periods' => $this->payroll->hostOpenPeriods($host)->all(),
                'advance_outstanding' => $this->payroll->outstandingAdvances($host),
            ],
            'points' => $this->hostPoints($host),
            'rating' => $host->ratings()->orderByDesc('month_year')->first()?->only('month_year', 'rating'),
            'rating_max' => config('vidhelp.rating.max'),
            'hours_by_day' => $this->hoursByDay($host),
        ];
    }

    /**
     * The host's sessions from the start of today for HOST_SCHEDULE_DAYS days (covers, event blocks
     * and the ones someone covers for them included), each with its check-in state; null when covered.
     *
     * @return list<array>
     */
    private function hostSessions(HostProfile $host): array
    {
        $now = now();

        return $this->attendance->sessions($host, today(), today()->addDays(self::HOST_SCHEDULE_DAYS))
            ->map(fn (array $session) => [
                // What check-in needs to find the session
                'slot_id' => $session['slot_id'],
                'date' => $session['date'],
                'backup_request_id' => $session['backup_request_id'],
                'event_claim_id' => $session['event_claim_id'] ?? null,
                'brand' => $session['brand'],
                'role' => $session['role'],
                'event_name' => $session['event_name'] ?? null,
                'covered_for' => $session['covered_for'] ?? null,
                'covered_by' => $session['covered_by'] ?? null,
                'start_at' => $session['start_at']->toIso8601String(),
                'end_at' => $session['end_at']->toIso8601String(),
                'check_in_at' => $session['attendance']?->check_in_at?->toIso8601String(),
                'state' => $session['role'] === 'off' ? null : $this->sessionState($session, $now),
            ])
            ->all();
    }

    /** Counts of what the host still has to do or keep an eye on; each links to the page where it is done. */
    private function hostAttention(HostProfile $host): array
    {
        $ledBrandIds = $host->assignments()->where('is_leader', true)->where('status', 'active')->select('brand_id');

        return [
            // Over and still without a report (the Live page lists the last week)
            'reports_to_send' => Attendance::where('host_id', $host->id)
                ->whereDoesntHave('report')
                ->where('scheduled_end_at', '<=', now())
                ->where('scheduled_end_at', '>', now()->subWeek())
                ->count(),
            // Sick leave whose doctor's letter can still come in time
            'sick_letters_due' => BackupRequest::where('requesting_host_id', $host->id)
                ->where('reason_type', 'sick')
                ->whereNotIn('status', ['cancelled', 'rejected'])
                ->whereDoesntHave('attachments')
                ->where('start_at', '>', now()->subHours(config('vidhelp.backup.sick_letter_grace_hours')))
                ->count(),
            'backups_uncovered' => BackupRequest::where('requesting_host_id', $host->id)
                ->whereIn('status', ['open', 'pending'])
                ->where('end_at', '>', now())
                ->count(),
            // As a brand's PIC: periods that reached the target, waiting for the payment request
            'periods_to_request' => PaymentPeriod::where('status', 'waiting_payment')->whereIn('brand_id', $ledBrandIds)->count(),
        ];
    }

    /**
     * Upcoming backups of other hosts this host could still apply for; `asked_me` = the ones that named them.
     *
     * @return array{count: int, asked_me: int}
     */
    private function coverChances(HostProfile $host): array
    {
        $chances = BackupRequest::whereIn('status', ['open', 'pending'])
            ->where('start_at', '>', now())
            ->where('requesting_host_id', '!=', $host->id)
            ->whereDoesntHave('applications', fn ($q) => $q->where('applicant_host_id', $host->id)->where('status', 'applied'))
            ->with(['brand:id,name', 'requester.user', 'nominees'])
            ->get();
        $context = $this->backups->coverContext(collect([$host]), $chances);
        $chances = $chances->filter(fn (BackupRequest $backup) => $this->backups->ineligibleReason($host, $backup, $context) === null);

        return [
            'count' => $chances->count(),
            'asked_me' => $chances->filter(fn (BackupRequest $backup) => $backup->nominees->contains('nominee_host_id', $host->id))->count(),
        ];
    }

    /**
     * Points this period (read without starting a balance) and the highest SP issued in it.
     *
     * @return array{points: int, opening_points: int, sp_level: int, period: array{start: string, end: string}}
     */
    private function hostPoints(HostProfile $host): array
    {
        [$start, $end] = $this->points->periodFor(today());
        $opening = (int) config('vidhelp.points.starting_points');
        $balance = PointBalance::where('host_id', $host->id)->whereDate('period_start', $start)->first();

        return [
            'points' => $balance->current_points ?? $opening,
            'opening_points' => $balance->opening_points ?? $opening,
            'sp_level' => $this->points->currentLevel($host),
            'period' => ['start' => $start->toDateString(), 'end' => $end->toDateString()],
        ];
    }

    /** Counts of things waiting on staff; each links to the page where it is handled. */
    public function attention(): array
    {
        return [
            'pending_signups' => User::where('status', 'pending')->count(),
            'backups_pending' => BackupRequest::where('status', 'pending')->where('end_at', '>', now())->count(),
            'backups_uncovered_soon' => BackupRequest::where('status', 'open')
                ->where('start_at', '<', now()->addDay())
                ->where('end_at', '>', now())
                ->count(),
            'reports_flagged' => LiveReport::where('status', 'flagged')->count(),
            'reports_missing' => Attendance::whereDoesntHave('report')->where('report_due_at', '<', now())->count(),
            'periods_to_request' => PaymentPeriod::where('status', 'waiting_payment')->count(),
            'periods_awaiting_brand' => PaymentPeriod::where('status', 'requested')->count(),
        ];
    }

    /**
     * Upcoming backups still without a cover (open, or applicants waiting on a decision), soonest first.
     *
     * @return list<array>
     */
    public function backupNeeds(): array
    {
        return BackupRequest::with(['brand:id,name', 'requester.user:id,name'])
            ->withCount(['applications as applicants_count' => fn ($q) => $q->where('status', 'applied')])
            ->whereIn('status', ['open', 'pending'])
            ->where('end_at', '>', now())
            ->orderBy('start_at')
            ->limit(self::BACKUP_ROWS)
            ->get()
            ->map(fn (BackupRequest $backup) => [
                'id' => $backup->id,
                'brand' => $backup->brand->only('id', 'name'),
                'requester_name' => $backup->requester->user->name,
                'reason_type' => $backup->reason_type,
                'request_type' => $backup->request_type,
                'start_at' => $backup->start_at->toIso8601String(),
                'end_at' => $backup->end_at->toIso8601String(),
                'status' => $backup->status,
                'applicants_count' => $backup->applicants_count,
                'auto_fill_at' => $backup->auto_fill_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * Every session happening today (covers and event blocks included) with its check-in state.
     *
     * @return array{sessions: list<array>, counts: array<string, int>}
     */
    public function today(): array
    {
        $from = today();
        $to = today()->addDay();
        $now = now();

        $hosts = HostProfile::with('user:id,name')
            ->where('status', 'active')
            ->whereHas('assignments', fn ($q) => $q->where('status', 'active'))
            ->get();

        $sessions = $hosts
            ->flatMap(fn (HostProfile $host) => $this->attendance->sessions($host, $from, $to)
                ->reject(fn (array $session) => $session['role'] === 'off')
                ->map(fn (array $session) => [
                    'host' => ['id' => $host->id, 'name' => $host->user->name],
                    'brand' => $session['brand'],
                    'role' => $session['role'],
                    'event_name' => $session['event_name'] ?? null,
                    'covered_for' => $session['covered_for'] ?? null,
                    'start_at' => $session['start_at']->toIso8601String(),
                    'end_at' => $session['end_at']->toIso8601String(),
                    'check_in_at' => $session['attendance']?->check_in_at?->toIso8601String(),
                    'state' => $this->sessionState($session, $now),
                ]))
            ->sortBy('start_at')
            ->values();

        return [
            'sessions' => $sessions->all(),
            'counts' => $sessions->countBy('state')->all(),
        ];
    }

    /** live · done · late (started, no check-in) · missed (ended, no check-in) · upcoming */
    private function sessionState(array $session, CarbonInterface $now): string
    {
        $attendance = $session['attendance'];

        return match (true) {
            $attendance?->check_out_at !== null => 'done',
            $attendance?->check_in_at !== null => 'live',
            $now->gte($session['end_at']) => 'missed',
            $now->gte($session['start_at']) => 'late',
            default => 'upcoming',
        };
    }

    /**
     * Each active brand's running payment period: hours against target, reported GMV, estimated host pay.
     *
     * @return list<array>
     */
    public function brands(): array
    {
        $gmvTracked = array_key_exists('gmv', config('vidhelp.report_metrics'));

        return Brand::where('status', 'active')->orderBy('name')->get()
            ->map(function (Brand $brand) use ($gmvTracked) {
                $period = $this->payroll->openPeriod($brand);
                if (! $period) {
                    return ['id' => $brand->id, 'name' => $brand->name, 'period' => null];
                }

                $summary = $this->payroll->breakdown($period)['summary'];

                return [
                    'id' => $brand->id,
                    'name' => $brand->name,
                    'period' => [
                        'id' => $period->id,
                        'start' => $period->period_start->toDateString(),
                        'status' => $period->status,
                        // Hours still to go before the target closes it
                        'hours_left' => max(0, round($period->target_hours - $summary['carried_in_hours'] - $summary['worked_hours'], 2)),
                    ],
                    ...$summary,
                    'gmv' => $gmvTracked ? $this->gmv($brand, $period) : null,
                ];
            })
            ->values()
            ->all();
    }

    /** Sum of GMV on approved live reports for sessions inside the period. */
    private function gmv(Brand $brand, PaymentPeriod $period): float
    {
        return (float) LiveReport::where('brand_id', $brand->id)
            ->where('status', 'approved')
            ->whereHas('attendance', fn ($q) => $q->whereBetween('session_date', [
                $period->period_start->toDateString(),
                ($period->period_end ?? today())->toDateString(),
            ]))
            ->get(['metrics'])
            ->sum(fn (LiveReport $report) => (float) ($report->metrics['gmv'] ?? 0));
    }

    /**
     * Approved (paid) live hours per day, oldest first, including days with none: everyone's, or one host's.
     *
     * @return list<array{date: string, hours: float}>
     */
    public function hoursByDay(?HostProfile $host = null): array
    {
        $first = CarbonImmutable::today()->subDays(self::HOURS_CHART_DAYS - 1);

        $hours = WorkSession::where('session_date', '>=', $first->toDateString())
            ->when($host, fn ($q) => $q->where('host_id', $host->id))
            ->selectRaw('session_date, sum(duration_hours) as hours')
            ->groupBy('session_date')
            ->pluck('hours', 'session_date')
            ->mapWithKeys(fn ($total, $date) => [substr((string) $date, 0, 10) => round((float) $total, 2)]);

        return collect(range(0, self::HOURS_CHART_DAYS - 1))
            ->map(fn (int $offset) => $first->addDays($offset)->toDateString())
            ->map(fn (string $date) => ['date' => $date, 'hours' => $hours->get($date, 0.0)])
            ->all();
    }

    public function people(): array
    {
        [$pointsStart] = $this->points->periodFor(today());

        return [
            'active_hosts' => HostProfile::where('status', 'active')->count(),
            'operators' => User::role('operator')->where('status', 'active')->count(),
            'admins' => User::role('admin')->where('status', 'active')->count(),
            'warning_letters' => WarningLetter::counting()->whereDate('period_start', $pointsStart->toDateString())->count(),
            'points_period' => [
                'start' => $pointsStart->toDateString(),
            ],
        ];
    }
}
