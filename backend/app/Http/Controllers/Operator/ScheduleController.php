<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ScheduleController extends Controller
{
    /**
     * List all schedules (filterable by date, host, status).
     * TODO: Implement with Schedule model.
     */
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'message' => 'Schedule listing — to be implemented',
            'schedules' => [],
        ]);
    }

    /**
     * Create a new schedule / assign host to a live session.
     */
    public function store(Request $request): JsonResponse
    {
        // TODO: Validate and create schedule
        return response()->json([
            'message' => 'Schedule creation — to be implemented',
        ], 201);
    }

    /**
     * Update schedule (reschedule, change host).
     */
    public function update(Request $request, int $id): JsonResponse
    {
        return response()->json([
            'message' => 'Schedule update — to be implemented',
        ]);
    }

    /**
     * Delete/cancel a schedule.
     */
    public function destroy(int $id): JsonResponse
    {
        return response()->json([
            'message' => 'Schedule cancelled',
        ]);
    }
}
