<?php

namespace App\Http\Controllers\Finance;

use App\Http\Controllers\Controller;
use App\Models\CashAdvance;
use App\Models\HostProfile;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Kasbon: record advances; installments come off the host's next salary slips
 * (or the host pays the rest back directly).
 */
class CashAdvanceController extends Controller
{
    public function __construct(private PayrollService $payroll) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => 'nullable|in:open,paid']);

        $advances = CashAdvance::query()
            ->with(['host.user', 'brand:id,name', 'installments', 'recorder:id,name', 'settler:id,name'])
            ->when($request->status === 'open', fn ($q) => $q->whereIn('status', ['unpaid', 'in_progress']))
            ->when($request->status === 'paid', fn ($q) => $q->where('status', 'paid'))
            ->latest('requested_at')
            ->limit(200)
            ->get()
            ->map(fn (CashAdvance $advance) => [
                ...$advance->toArray(),
                'deducted_amount' => $advance->installments->where('status', 'deducted')->sum('amount'),
                'remaining_amount' => $advance->installments->where('status', 'scheduled')->sum('amount'),
            ]);

        return response()->json(['advances' => $advances]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'host_id' => 'required|exists:host_profiles,id',
            'brand_id' => 'nullable|exists:brands,id',
            'type' => 'required|in:early_payment,loan',
            'total_amount' => 'required|integer|min:1000|max:1000000000',
            'installment_count' => 'required|integer|min:1|max:24',
            'notes' => 'nullable|string|max:255',
        ]);

        $advance = $this->payroll->recordAdvance(
            HostProfile::findOrFail($validated['host_id']),
            collect($validated)->except('host_id')->all(),
            $request->user(),
        );

        return response()->json(['advance' => $advance, 'message' => 'Kasbon recorded'], 201);
    }

    /**
     * The host paid the rest back in cash or by transfer.
     */
    public function settle(Request $request, CashAdvance $advance): JsonResponse
    {
        $validated = $request->validate(['note' => 'nullable|string|max:255']);

        $advance = $this->payroll->settleAdvance($advance, $request->user(), $validated['note'] ?? null);

        return response()->json(['advance' => $advance, 'message' => 'Kasbon marked as paid back']);
    }

    /**
     * Spread what's still owed over a new number of installments.
     */
    public function reschedule(Request $request, CashAdvance $advance): JsonResponse
    {
        $validated = $request->validate(['installment_count' => 'required|integer|min:1|max:24']);

        $advance = $this->payroll->rescheduleAdvance($advance, (int) $validated['installment_count']);

        return response()->json(['advance' => $advance, 'message' => 'Remaining installments rescheduled']);
    }

    /**
     * Remove a kasbon recorded by mistake, as long as nothing was paid back yet.
     */
    public function destroy(CashAdvance $advance): JsonResponse
    {
        if ($advance->installments()->where('status', '!=', 'scheduled')->exists()) {
            return response()->json(['message' => 'Part of this kasbon was already paid back; it can no longer be removed.'], 422);
        }

        $advance->delete();

        return response()->json(['message' => 'Kasbon removed']);
    }
}
