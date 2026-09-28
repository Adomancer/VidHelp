<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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

    public function store(Request $request): JsonResponse
    {
        $brand = Brand::create($this->validated($request));

        return response()->json(['brand' => $brand, 'message' => 'Brand created'], 201);
    }

    public function update(Request $request, Brand $brand): JsonResponse
    {
        $brand->update($this->validated($request, $brand));

        return response()->json(['brand' => $brand, 'message' => 'Brand updated']);
    }

    private function validated(Request $request, ?Brand $brand = null): array
    {
        $required = $brand ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:255', Rule::unique('brands')->ignore($brand)],
            'is_obs' => 'sometimes|boolean',
            'target_hours_per_period' => "$required|integer|min:1|max:10000",
            'payment_cycle_days' => "$required|integer|min:1|max:365",
            'status' => 'sometimes|in:active,inactive',
        ]);
    }
}
