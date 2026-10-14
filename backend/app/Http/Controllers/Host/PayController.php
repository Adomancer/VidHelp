<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\CashAdvance;
use App\Models\HostProfile;
use App\Models\HourAdjustment;
use App\Models\PaymentItem;
use App\Models\PaymentPeriod;
use App\Models\SalarySlip;
use App\Models\WorkSession;
use App\Services\PayrollReport;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class PayController extends Controller
{
    public function __construct(private PayrollService $payroll)
    {
    }

    /**
     * Pay so far in open periods (estimate at today's rate), my salary slips and my kasbon.
     * A brand's leader also gets that brand's periods, to request payment (`brand_periods`).
     */
    public function index(Request $request): JsonResponse
    {
        $host = $this->host($request);

        // Periods I worked in, and the ones my hours over a target carried into
        $periodIds = WorkSession::where('host_id', $host->id)->whereNotNull('payment_period_id')->pluck('payment_period_id')
            ->merge(HourAdjustment::where('host_id', $host->id)->pluck('payment_period_id'))
            ->merge(PaymentItem::where('host_id', $host->id)->where('carried_out_hours', '>', 0)->with('period')->get()
                ->map(fn (PaymentItem $item) => $this->payroll->nextPeriod($item->period)?->id)
                ->filter())
            ->unique();

        $current = PaymentPeriod::with('brand:id,name')
            ->whereIn('id', $periodIds)
            ->whereIn('status', ['in_progress', 'waiting_payment'])
            ->orderBy('period_start')
            ->get()
            ->map(function (PaymentPeriod $period) use ($host) {
                $row = $this->payroll->breakdown($period)['hosts']->firstWhere('host_id', $host->id);

                return $row ? [
                    'period_id' => $period->id,
                    'brand' => $period->brand->only('id', 'name'),
                    'period_start' => $period->period_start->toDateString(),
                    'period_end' => $period->period_end?->toDateString(),
                    'status' => $period->status,
                    'session_count' => $row['session_count'],
                    'carried_in_hours' => $row['carried_in_hours'],
                    'worked_hours' => $row['worked_hours'],
                    'hours' => $row['hours'],
                    'carried_out_hours' => $row['carried_out_hours'],
                    'rate_per_hour' => $row['rate_per_hour'],
                    'estimate' => $row['amount'],
                    'host_paid' => $row['host_paid'],
                ] : null;
            })
            ->filter()
            ->values();

        return response()->json([
            'current' => $current,
            'brand_periods' => $this->brandPeriods($host),
            'slips' => SalarySlip::where('host_id', $host->id)
                ->with('period.brand:id,name')
                ->latest('generated_at')
                ->limit(24)
                ->get()
                ->map(fn (SalarySlip $slip) => [
                    'id' => $slip->id,
                    'brand' => $slip->period->brand->only('id', 'name'),
                    'period_start' => $slip->period->period_start->toDateString(),
                    'period_end' => $slip->period->period_end?->toDateString(),
                    'gross_amount' => $slip->gross_amount,
                    'advance_deduction' => $slip->advance_deduction,
                    'net_amount' => $slip->net_amount,
                    'generated_at' => $slip->generated_at,
                ]),
            'advances' => CashAdvance::where('host_id', $host->id)
                ->with('installments')
                ->latest('requested_at')
                ->get()
                ->map(fn (CashAdvance $advance) => [
                    ...$advance->only('id', 'type', 'total_amount', 'installment_count', 'status', 'notes', 'requested_at'),
                    'remaining' => $advance->installments->where('status', 'scheduled')->sum('amount'),
                ]),
        ]);
    }

    public function slip(Request $request, SalarySlip $slip): JsonResponse
    {
        abort_unless($slip->host_id === $this->host($request)->id, 403, 'Ini bukan slip gajimu.');

        return response()->json(['slip' => $this->payroll->slipDetail($slip)]);
    }

    /**
     * As the brand's leader: request payment for a period that reached its target.
     */
    public function requestPayment(Request $request, PaymentPeriod $period): JsonResponse
    {
        $this->ensureLeader($request, $period);

        $this->payroll->requestPayment($period, $request->user());

        return response()->json(['message' => 'Pembayaran diajukan. Unduh laporannya dan kirim ke brand.']);
    }

    /** The brand report (CSV) for a period I lead. */
    public function export(Request $request, PaymentPeriod $period, PayrollReport $report): BinaryFileResponse
    {
        $this->ensureLeader($request, $period);

        return $report->period($period, $request->user());
    }

    /**
     * The latest periods of every brand I lead: progress to the target and where payment stands.
     *
     * @return list<array>
     */
    private function brandPeriods(HostProfile $host): array
    {
        $brandIds = $host->assignments()->where('is_leader', true)->where('status', 'active')->pluck('brand_id');

        return Brand::whereIn('id', $brandIds)->whereNotNull('payroll_start_date')->orderBy('name')->get()
            ->flatMap(function (Brand $brand) {
                $this->payroll->openPeriod($brand);

                return $brand->paymentPeriods()->with('paymentRequest.requester:id,name')->orderByDesc('period_start')->limit(4)->get()
                    ->map(function (PaymentPeriod $period) use ($brand) {
                        $summary = $this->payroll->breakdown($period)['summary'];
                        $open = ! $period->isLocked();

                        return [
                            'id' => $period->id,
                            'brand' => $brand->only('id', 'name'),
                            'period_start' => $period->period_start->toDateString(),
                            'period_end' => $period->period_end?->toDateString(),
                            'status' => $period->status,
                            'target_hours' => $period->target_hours,
                            // Toward the target: carried in + worked (may pass it; the rest carries on)
                            'progress_hours' => round($summary['carried_in_hours'] + $summary['worked_hours'], 2),
                            'achieved_hours' => $summary['achieved_hours'],
                            'closed_early' => $period->closed_by !== null,
                            'pending_reports' => $open && $period->status === 'waiting_payment' ? $this->payroll->pendingReports($period) : 0,
                            'pending_letters' => $open && $period->status === 'waiting_payment' ? $this->payroll->pendingCoverLetters($period) : 0,
                            'request' => $period->paymentRequest ? [
                                ...$period->paymentRequest->only('requested_at', 'paid_at'),
                                'requester' => $period->paymentRequest->requester?->name,
                            ] : null,
                        ];
                    });
            })
            ->values()
            ->all();
    }

    private function ensureLeader(Request $request, PaymentPeriod $period): void
    {
        abort_unless(
            $this->host($request)->assignments()->where('brand_id', $period->brand_id)->where('is_leader', true)->where('status', 'active')->exists(),
            403,
            'Hanya PIC (leader) brand ini yang bisa mengajukan pembayaran.'
        );
    }

    private function host(Request $request): HostProfile
    {
        return $request->user()->hostProfile ?? abort(404, 'Kamu tidak punya profil host.');
    }
}
