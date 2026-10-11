<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\CashAdvance;
use App\Models\HostProfile;
use App\Models\HourAdjustment;
use App\Models\PaymentItem;
use App\Models\PaymentPeriod;
use App\Models\SalarySlip;
use App\Models\WorkSession;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayController extends Controller
{
    public function __construct(private PayrollService $payroll)
    {
    }

    /**
     * Pay so far in open periods (estimate at today's rate), my salary slips and my kasbon.
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
                    'period_end' => $period->period_end->toDateString(),
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
            'slips' => SalarySlip::where('host_id', $host->id)
                ->with('period.brand:id,name')
                ->latest('generated_at')
                ->limit(24)
                ->get()
                ->map(fn (SalarySlip $slip) => [
                    'id' => $slip->id,
                    'brand' => $slip->period->brand->only('id', 'name'),
                    'period_start' => $slip->period->period_start->toDateString(),
                    'period_end' => $slip->period->period_end->toDateString(),
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

    private function host(Request $request): HostProfile
    {
        return $request->user()->hostProfile ?? abort(404, 'Kamu tidak punya profil host.');
    }
}
