<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostProfile;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\User;
use App\Models\WarningLetter;
use App\Models\WorkSession;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Figures for the dashboards: what needs attention, today's sessions, brand progress this period.
 */
class DashboardService
{
    public const HOURS_CHART_DAYS = 14;

    public function __construct(
        private AttendanceService $attendance,
        private PayrollService $payroll,
        private PointService $points,
    ) {}

    public function admin(): array
    {
        return [
            'attention' => $this->attention(),
            'today' => $this->today(),
            'brands' => $this->brands(),
            'hours_by_day' => $this->hoursByDay(),
            'people' => $this->people(),
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
     * Each active brand's current payment period: hours against target, reported GMV, estimated host pay.
     *
     * @return list<array>
     */
    public function brands(): array
    {
        $gmvTracked = array_key_exists('gmv', config('vidhelp.report_metrics'));

        return Brand::where('status', 'active')->orderBy('name')->get()
            ->map(function (Brand $brand) use ($gmvTracked) {
                $period = $this->payroll->periodFor($brand, today());
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
                        'end' => $period->period_end->toDateString(),
                        'status' => $period->status,
                        'days_left' => (int) today()->diffInDays($period->period_end, false) + 1,
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
                $period->period_end->toDateString(),
            ]))
            ->get(['metrics'])
            ->sum(fn (LiveReport $report) => (float) ($report->metrics['gmv'] ?? 0));
    }

    /**
     * Approved (paid) live hours per day, oldest first, including days with none.
     *
     * @return list<array{date: string, hours: float}>
     */
    public function hoursByDay(): array
    {
        $first = CarbonImmutable::today()->subDays(self::HOURS_CHART_DAYS - 1);

        $hours = WorkSession::where('session_date', '>=', $first->toDateString())
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
