<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MyRatingController extends Controller
{
    /**
     * View my ratings history.
     * TODO: Implement with Rating model.
     */
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'message' => 'My ratings — to be implemented',
            'ratings' => [],
            'average_rating' => 0,
        ]);
    }
}
