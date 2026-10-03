<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class BrandController extends Controller
{
    /**
     * List brands with their active host count and leader (operators use this too).
     */
    public function index(Request $request): JsonResponse
    {
        $brands = Brand::query()
            ->when($request->status, fn ($q, $status) => $q->where('status', $status))
            ->withCount(['assignments as active_hosts_count' => fn ($q) => $q->where('status', 'active')])
            ->with(['assignments' => fn ($q) => $q->where('is_leader', true)->where('status', 'active')->with('host.user:id,name')])
            ->orderBy('name')
            ->get()
            ->map(fn (Brand $brand) => [
                ...$brand->withoutRelations()->toArray(),
                'active_hosts_count' => $brand->active_hosts_count,
                'leader' => $brand->assignments->first()?->host->user->only('id', 'name'),
            ]);

        return response()->json(['brands' => $brands]);
    }

    /**
     * Hosts actively assigned to a brand, with their weekly availability (for placing slots).
     */
    public function hosts(Brand $brand): JsonResponse
    {
        $assignments = $brand->assignments()
            ->where('status', 'active')
            ->with(['host.user', 'host.availability'])
            ->get()
            ->sortBy('host.user.name')
            ->values();

        return response()->json(['assignments' => $assignments]);
    }

    public function store(Request $request, PayrollService $payroll): JsonResponse
    {
        $brand = Brand::create($this->validated($request));

        if ($brand->payroll_start_date) {
            $payroll->periodFor($brand, today());
        }

        return response()->json(['brand' => $brand, 'message' => 'Brand created'], 201);
    }

    public function update(Request $request, Brand $brand, PayrollService $payroll): JsonResponse
    {
        $validated = $this->validated($request, $brand);

        // Periods are laid out from the start date and cycle; changing either would shift every period
        $moves = fn (string $key) => array_key_exists($key, $validated) && (string) $validated[$key] !== (string) ($key === 'payroll_start_date'
            ? $brand->payroll_start_date?->toDateString()
            : $brand->{$key});
        if (($moves('payroll_start_date') || $moves('payment_cycle_days')) && $brand->paymentPeriods()->exists()) {
            throw ValidationException::withMessages([
                'payroll_start_date' => ['Payment periods already exist for this brand, so the payroll start date and cycle can no longer change.'],
            ]);
        }

        $brand->update($validated);

        if ($brand->payroll_start_date) {
            $payroll->assignUnassigned($brand);
            $payroll->periodFor($brand, today());
        }

        return response()->json(['brand' => $brand, 'message' => 'Brand updated']);
    }

    private function validated(Request $request, ?Brand $brand = null): array
    {
        $required = $brand ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:255', Rule::unique('brands')->ignore($brand)],
            'is_obs' => 'sometimes|boolean',
            'product_knowledge' => 'sometimes|nullable|string|max:20000',
            'target_hours_per_period' => "$required|integer|min:1|max:10000",
            'payment_cycle_days' => "$required|integer|min:1|max:365",
            'payroll_start_date' => 'sometimes|nullable|date_format:Y-m-d',
            'status' => 'sometimes|in:active,inactive',
        ]);
    }
}
