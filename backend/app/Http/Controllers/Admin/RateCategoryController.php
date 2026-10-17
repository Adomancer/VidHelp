<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use App\Models\HostRateCategory;
use App\Services\RateLevelService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class RateCategoryController extends Controller
{
    /** How many days ahead the page lists hosts about to move up a level. */
    private const PROMOTION_DAYS = 60;

    public function __construct(private RateLevelService $levels) {}

    /**
     * The levels by tenure with how many hosts each has, the hosts moving up a level in the
     * coming days, and the hosts whose level was set by hand.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'rate_categories' => HostRateCategory::withCount('hosts')->orderBy('min_tenure_months')->get(),
            'upcoming' => $this->levels->upcomingPromotions(self::PROMOTION_DAYS),
            'upcoming_days' => self::PROMOTION_DAYS,
            'pinned' => $this->levels->pinned(),
        ]);
    }

    /**
     * Changing categories re-places every host that isn't manually overridden.
     */
    public function store(Request $request): JsonResponse
    {
        $category = HostRateCategory::create($this->validated($request));
        HostProfile::syncAllRateCategories();

        return response()->json(['rate_category' => $category, 'message' => 'Level tarif dibuat'], 201);
    }

    public function update(Request $request, HostRateCategory $rateCategory): JsonResponse
    {
        $rateCategory->update($this->validated($request, $rateCategory));
        HostProfile::syncAllRateCategories();

        return response()->json(['rate_category' => $rateCategory, 'message' => 'Level tarif diperbarui']);
    }

    public function destroy(HostRateCategory $rateCategory): JsonResponse
    {
        if ($rateCategory->hosts()->exists()) {
            return response()->json(['message' => 'Level tarif ini masih dipakai oleh host.'], 422);
        }

        $rateCategory->delete();

        return response()->json(['message' => 'Level tarif dihapus']);
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
