<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HostRatingController extends Controller
{
    /**
     * List ratings for all hosts.
     * TODO: Implement with Rating model.
     */
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'message' => 'Host ratings — to be implemented',
            'ratings' => [],
        ]);
    }

    /**
     * Rate a host (per session or period).
     */
    public function store(Request $request): JsonResponse
    {
        // TODO: Validate and create rating
        return response()->json([
            'message' => 'Rating submitted — to be implemented',
        ], 201);
    }

    /**
     * Update an existing rating.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        return response()->json([
            'message' => 'Rating updated — to be implemented',
        ]);
    }
}
