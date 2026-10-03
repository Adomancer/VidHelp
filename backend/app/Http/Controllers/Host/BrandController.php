<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BrandController extends Controller
{
    /**
     * The brands I'm actively assigned to, with their product knowledge.
     */
    public function index(Request $request): JsonResponse
    {
        $profile = $request->user()->hostProfile;

        if (! $profile) {
            return response()->json(['brands' => []]);
        }

        $brands = Brand::query()
            ->whereHas('assignments', fn ($q) => $q->where('host_id', $profile->id)->where('status', 'active'))
            ->where('status', 'active')
            ->orderBy('name')
            ->get(['id', 'name', 'is_obs', 'product_knowledge']);

        return response()->json(['brands' => $brands]);
    }
}
