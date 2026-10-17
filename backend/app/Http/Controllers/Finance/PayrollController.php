<?php

namespace App\Http\Controllers\Finance;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\HostProfile;
use App\Models\HourAdjustment;
use App\Models\PaymentPeriod;
use App\Models\SalarySlip;
use App\Services\PayrollReport;
use App\Services\PayrollService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class PayrollController extends Controller
{
    /** Periods per page in the list. */
    private const PERIODS_PER_PAGE = 25;

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
     * Payroll at a glance: what waits for the PIC and for the brand, what runs, what was paid this month.
     */
    public function summary(): JsonResponse
    {
        return response()->json($this->payroll->overview());
    }

    /**
     * Payment periods a page at a time, with hours and pay totals. `status`: action (waiting for
     * the PIC's request or the brand's payment, longest waiting first), in_progress (by brand),
     * paid (newest first); none = every period, newest first. `search` matches the brand name.
     */
    public function periods(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => 'nullable|in:action,in_progress,paid',
            'search' => 'nullable|string|max:100',
        ]);
        $status = $validated['status'] ?? null;
        $brandName = Brand::select('name')->whereColumn('brands.id', 'payment_periods.brand_id');

        $query = PaymentPeriod::query()
            ->with(['brand:id,name', 'paymentRequest'])
            ->when($validated['search'] ?? null, fn ($q, $search) => $q->whereHas('brand', fn ($q) => $q->where('name', 'like', "%{$search}%")))
            ->when($status === 'action', fn ($q) => $q->whereIn('status', ['waiting_payment', 'requested']))
            ->when(in_array($status, ['in_progress', 'paid'], true), fn ($q) => $q->where('status', $status));

        match ($status) {
            'action' => $query->orderBy('closed_at'),
            'in_progress' => $query->orderBy($brandName),
            'paid' => $query->orderByDesc('period_end'),
            default => $query->orderByDesc('period_start'),
        };

        $periods = $query->orderBy($brandName)
            ->paginate(self::PERIODS_PER_PAGE)
            ->through(function (PaymentPeriod $period) {
                ['hosts' => $hosts, 'summary' => $summary] = $this->payroll->breakdown($period);

                return [
                    ...$period->toArray(),
                    ...$summary,
                    'hosts' => $hosts->count(),
                    // Waiting on the brand since the request, on the PIC since the target closed it
                    'waiting_since' => match ($period->status) {
                        'requested' => $period->paymentRequest?->requested_at,
                        'waiting_payment' => $period->closed_at,
                        default => null,
                    },
                ];
            });

        return response()->json($periods);
    }

    /**
     * One period: per-host pay, brand invoice numbers, adjustments, payment requests (cancelled ones too) and slips.
     */
    public function show(PaymentPeriod $period): JsonResponse
    {
        ['hosts' => $hosts, 'summary' => $summary] = $this->payroll->breakdown($period);

        return response()->json([
            'period' => $period->load(['brand:id,name', 'paymentRequest.requester:id,name', 'closer:id,name']),
            'summary' => $summary,
            'pending_reports' => $period->isLocked() ? 0 : $this->payroll->pendingReports($period),
            'pending_letters' => $period->isLocked() ? 0 : $this->payroll->pendingCoverLetters($period),
            'requests' => $period->paymentRequests()->with(['requester:id,name', 'canceller:id,name'])->get(),
            'hosts' => $hosts,
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
            throw ValidationException::withMessages(['hours_added' => ['Tambah atau kurangi jam atau sesi.']]);
        }

        $adjustment = $period->adjustments()->create([
            ...$validated,
            'hours_added' => round((float) $validated['hours_added'], 2),
            'created_by' => $request->user()->id,
        ]);

        return response()->json(['adjustment' => $adjustment, 'message' => 'Penyesuaian ditambahkan'], 201);
    }

    public function destroyAdjustment(HourAdjustment $adjustment): JsonResponse
    {
        $this->ensureOpen($adjustment->period);

        $adjustment->delete();

        return response()->json(['message' => 'Penyesuaian dihapus']);
    }

    /**
     * Finance only: close a running period before its target (e.g. the brand stopped going live) so it can be billed.
     */
    public function close(Request $request, PaymentPeriod $period): JsonResponse
    {
        $this->payroll->closeEarly($period, $request->user());

        return response()->json(['message' => 'Periode ditutup; PIC brand bisa mengajukan pembayaran.']);
    }

    /**
     * Request on the PIC's behalf (normally the brand's leader host does it).
     */
    public function requestPayment(Request $request, PaymentPeriod $period): JsonResponse
    {
        $this->payroll->requestPayment($period, $request->user());

        return response()->json(['message' => 'Periode dikunci dan pembayaran diajukan. Unduh laporan untuk brand.']);
    }

    /**
     * Take the request back and unlock the period so it can be corrected and requested again.
     */
    public function cancelRequest(Request $request, PaymentPeriod $period): JsonResponse
    {
        $validated = $request->validate(['reason' => 'required|string|max:255']);

        $this->payroll->cancelRequest($period, $request->user(), $validated['reason']);

        return response()->json(['message' => 'Pengajuan dibatalkan; periode bisa diubah lagi.']);
    }

    /**
     * The brand paid, optionally with the transfer's reference number.
     */
    public function markPaid(Request $request, PaymentPeriod $period): JsonResponse
    {
        $validated = $request->validate(['reference' => 'nullable|string|max:100']);

        $slips = $this->payroll->markPaid($period, $validated['reference'] ?? null);

        return response()->json(['message' => "Ditandai lunas; {$slips->count()} slip gaji dibuat."]);
    }

    /**
     * The brand report as a CSV download.
     */
    /**
     * The brand report for one period as Excel (hours per host and every session; no pay).
     */
    public function export(Request $request, PaymentPeriod $period, PayrollReport $report): BinaryFileResponse
    {
        return $report->period($period, $request->user());
    }

    /**
     * The finance report as Excel for a day, week (Mon–Sun), month or year around `date`
     * (default today), a custom `from`–`to`, or everything; optionally one brand.
     */
    public function report(Request $request, PayrollReport $report): BinaryFileResponse
    {
        $validated = $request->validate([
            'range' => 'required|in:day,week,month,year,all,custom',
            'date' => 'nullable|date_format:Y-m-d',
            'from' => 'required_if:range,custom|nullable|date_format:Y-m-d',
            'to' => 'required_if:range,custom|nullable|date_format:Y-m-d|after_or_equal:from',
            'brand_id' => 'nullable|exists:brands,id',
        ]);

        $date = CarbonImmutable::parse($validated['date'] ?? today())->locale('id');
        [$from, $to, $label] = match ($validated['range']) {
            'day' => [$date, $date, 'Harian · '.$date->translatedFormat('l, j F Y')],
            'week' => [$date->startOfWeek(), $date->endOfWeek(), 'Mingguan · '.$date->startOfWeek()->translatedFormat('j M').' – '.$date->endOfWeek()->translatedFormat('j M Y')],
            'month' => [$date->startOfMonth(), $date->endOfMonth(), 'Bulanan · '.$date->translatedFormat('F Y')],
            'year' => [$date->startOfYear(), $date->endOfYear(), 'Tahunan · '.$date->year],
            'all' => [null, null, 'Semua waktu'],
            'custom' => [
                $from = CarbonImmutable::parse($validated['from'])->locale('id'),
                $to = CarbonImmutable::parse($validated['to'])->locale('id'),
                'Rentang · '.$from->translatedFormat('j M Y').' – '.$to->translatedFormat('j M Y'),
            ],
        };

        return $report->range($from, $to, isset($validated['brand_id']) ? Brand::find($validated['brand_id']) : null, $request->user(), $label);
    }

    public function slip(SalarySlip $slip): JsonResponse
    {
        return response()->json(['slip' => $this->payroll->slipDetail($slip)]);
    }

    private function ensureOpen(PaymentPeriod $period): void
    {
        if ($period->isLocked()) {
            throw ValidationException::withMessages(['period' => ['Periode ini terkunci; pembayaran sudah diajukan.']]);
        }
    }
}
