<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HostController extends Controller
{
    /**
     * Hosts with their rate level and brand assignments. No KTP/bank data.
     */
    public function index(Request $request): JsonResponse
    {
        $hosts = HostProfile::query()
            ->with(['user', 'rateCategory:id,name', 'assignments.brand:id,name'])
            ->when($request->search, fn ($q, $search) => $q->whereHas('user', fn ($q) => $q
                ->where('name', 'like', "%{$search}%")
                ->orWhere('email', 'like', "%{$search}%")))
            ->when($request->brand_id, fn ($q, $brandId) => $q->whereHas('assignments', fn ($q) => $q
                ->where('brand_id', $brandId)
                ->where('status', 'active')))
            ->when($request->status, fn ($q, $status) => $q->where('status', $status))
            ->orderBy(
                User::select('name')->whereColumn('users.id', 'host_profiles.user_id')
            )
            ->paginate(20);

        return response()->json($hosts);
    }
}
