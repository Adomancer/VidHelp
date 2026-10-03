<?php

namespace App\Http\Controllers\Finance;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\HostProfile;
use App\Models\HourAdjustment;
use App\Models\PaymentPeriod;
use App\Models\SalarySlip;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

class PayrollController extends Controller
{
    public function __construct(private PayrollService $payroll) {}

    /**
     * Brands with their payroll start (for the brand filter and the "no start date" warning).
     */
    public function brands(): JsonResponse
    {
        return response()->json([
            'brands' => Brand::orderBy('name')->get(['id', 'name', 'status', 'payroll_start_date']),
        ]);
    }

    /**
     * Active hosts to pick for kasbon or an hour adjustment; with brand_id, only that brand's hosts.
     */
    public function hosts(Request $request): JsonResponse
    {
        $request->validate(['brand_id' => 'nullable|uuid']);

        $hosts = HostProfile::query()
            ->where('status', 'active')
            ->when($request->brand_id, fn ($q, $id) => $q->whereHas('assignments', fn ($q) => $q->where('brand_id', $id)->where('status', 'active')))
            ->with('user:id,name')
            ->get()
            ->map(fn (HostProfile $host) => ['host_id' => $host->id, 'name' => $host->user->name])
            ->sortBy('name')
            ->values();

        return response()->json(['hosts' => $hosts]);
    }

    /**
     * Recent payment periods (newest first), with worked hours and pay totals.
     */
    public function periods(Request $request): JsonResponse
    {
        $request->validate(['brand_id' => 'nullable|uuid']);

        $periods = PaymentPeriod::query()
            ->with('brand:id,name')
            ->when($request->brand_id, fn ($q, $id) => $q->where('brand_id', $id))
            ->orderByDesc('period_start')
            ->limit(60)
            ->get()
            ->map(function (PaymentPeriod $period) {
                $totals = $this->payroll->hostTotals($period);

                return [...$period->toArray(), ...$this->payroll->summary($period, $totals), 'hosts' => $totals->count()];
            });

        return response()->json(['periods' => $periods]);
    }

    /**
     * One period: per-host pay, brand invoice numbers, adjustments, payment request and slips.
     */
    public function show(PaymentPeriod $period): JsonResponse
    {
        $totals = $this->payroll->hostTotals($period);

        return response()->json([
            'period' => $period->load(['brand:id,name', 'paymentRequest.requester:id,name']),
            'summary' => $this->payroll->summary($period, $totals),
            'hosts' => $totals,
            'adjustments' => $period->adjustments()->with(['host.user', 'creator:id,name'])->latest()->get(),
            'slips' => $period->slips()->with('host.user')->get(),
        ]);
    }

    /**
     * Add or remove hours/sessions for a host (e.g. a disrupted live), with a reason.
     */
    public function storeAdjustment(Request $request, PaymentPeriod $period): JsonResponse
    {
        $this->ensureOpen($period);

        $validated = $request->validate([
            'host_id' => 'required|exists:host_profiles,id',
            'sessions_added' => 'required|integer|between:-50,50',
            'hours_added' => 'required|numeric|between:-200,200',
            'notes' => 'required|string|max:255',
        ]);
        if ((int) $validated['sessions_added'] === 0 && (float) $validated['hours_added'] == 0.0) {
            throw ValidationException::withMessages(['hours_added' => ['Add or remove some hours or sessions.']]);
        }

        $adjustment = $period->adjustments()->create([
            ...$validated,
            'hours_added' => round((float) $validated['hours_added'], 2),
            'created_by' => $request->user()->id,
        ]);

        return response()->json(['adjustment' => $adjustment, 'message' => 'Adjustment added'], 201);
    }

    public function destroyAdjustment(HourAdjustment $adjustment): JsonResponse
    {
        $this->ensureOpen($adjustment->period);

        $adjustment->delete();

        return response()->json(['message' => 'Adjustment removed']);
    }

    public function requestPayment(Request $request, PaymentPeriod $period): JsonResponse
    {
        $this->payroll->requestPayment($period, $request->user());

        return response()->json(['message' => 'Period locked and payment requested. Download the report for the brand.']);
    }

    public function markPaid(PaymentPeriod $period): JsonResponse
    {
        $slips = $this->payroll->markPaid($period);

        return response()->json(['message' => "Marked as paid; {$slips->count()} salary slip(s) created."]);
    }

    /**
     * The brand report as a CSV download.
     */
    public function export(PaymentPeriod $period): Response
    {
        $name = str($period->brand->name)->slug().'-'.$period->period_start->toDateString().'.csv';

        return response($this->payroll->exportCsv($period->load('brand')), 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$name}\"",
        ]);
    }

    public function slip(SalarySlip $slip): JsonResponse
    {
        return response()->json(['slip' => $this->payroll->slipDetail($slip)]);
    }

    private function ensureOpen(PaymentPeriod $period): void
    {
        if ($period->isLocked()) {
            throw ValidationException::withMessages(['period' => ['This period is locked; payment was already requested.']]);
        }
    }
}
