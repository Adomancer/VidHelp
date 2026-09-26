<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MyScheduleController extends Controller
{
    /**
     * View my upcoming schedules.
     * TODO: Implement with Schedule model.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'message' => 'My schedule — to be implemented',
            'schedules' => [],
        ]);
    }

    /**
     * View a specific schedule detail.
     */
    public function show(int $id): JsonResponse
    {
        return response()->json([
            'message' => 'Schedule detail — to be implemented',
        ]);
    }
}
