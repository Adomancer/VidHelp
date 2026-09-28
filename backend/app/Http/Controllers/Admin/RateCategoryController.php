<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use App\Models\HostRateCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class RateCategoryController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'rate_categories' => HostRateCategory::withCount('hosts')->orderBy('min_tenure_months')->get(),
        ]);
    }

    /**
     * Changing categories re-places every host that isn't manually overridden.
     */
    public function store(Request $request): JsonResponse
    {
        $category = HostRateCategory::create($this->validated($request));
        HostProfile::syncAllRateCategories();

        return response()->json(['rate_category' => $category, 'message' => 'Rate level created'], 201);
    }

    public function update(Request $request, HostRateCategory $rateCategory): JsonResponse
    {
        $rateCategory->update($this->validated($request, $rateCategory));
        HostProfile::syncAllRateCategories();

        return response()->json(['rate_category' => $rateCategory, 'message' => 'Rate level updated']);
    }

    public function destroy(HostRateCategory $rateCategory): JsonResponse
    {
        if ($rateCategory->hosts()->exists()) {
            return response()->json(['message' => 'This rate level is still used by hosts.'], 422);
        }

        $rateCategory->delete();

        return response()->json(['message' => 'Rate level deleted']);
    }

    private function validated(Request $request, ?HostRateCategory $category = null): array
    {
        $required = $category ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:100', Rule::unique('host_rate_categories')->ignore($category)],
            'min_tenure_months' => [$required, 'integer', 'min:0', 'max:600', Rule::unique('host_rate_categories')->ignore($category)],
            'rate_per_hour' => "$required|numeric|min:0|max:100000000",
        ]);
    }
}
