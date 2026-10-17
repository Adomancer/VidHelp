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

        $payroll->openPeriod($brand);

        return response()->json(['brand' => $brand, 'message' => 'Brand dibuat'], 201);
    }

    public function update(Request $request, Brand $brand, PayrollService $payroll): JsonResponse
    {
        $validated = $this->validated($request, $brand);

        // The first period starts on this date; moving it would shift every period after
        $moves = array_key_exists('payroll_start_date', $validated)
            && (string) $validated['payroll_start_date'] !== (string) $brand->payroll_start_date?->toDateString();
        if ($moves && $brand->paymentPeriods()->exists()) {
            throw ValidationException::withMessages([
                'payroll_start_date' => ['Brand ini sudah punya periode pembayaran, jadi tanggal mulai penggajian tidak bisa diubah lagi.'],
            ]);
        }

        $brand->update($validated);

        if ($brand->payroll_start_date) {
            $payroll->assignUnassigned($brand);
            // A new target applies to the running period too, and may already be reached
            $open = $payroll->openPeriod($brand);
            $open->update(['target_hours' => $brand->target_hours_per_period]);
            $payroll->closeIfTargetReached($open);
        }

        return response()->json(['brand' => $brand, 'message' => 'Brand diperbarui']);
    }

    private function validated(Request $request, ?Brand $brand = null): array
    {
        $required = $brand ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:255', Rule::unique('brands')->ignore($brand)],
            'is_obs' => 'sometimes|boolean',
            'target_hours_per_period' => "$required|integer|min:1|max:10000",
            'payroll_start_date' => 'sometimes|nullable|date_format:Y-m-d',
            'status' => 'sometimes|in:active,inactive',
        ]);
    }
}
