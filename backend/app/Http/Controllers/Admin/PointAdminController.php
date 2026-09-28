<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use App\Models\PointLog;
use App\Models\WarningLetter;
use App\Services\PointService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Admin-only corrections: cancel a wrong entry, issue or cancel an SP by hand.
 */
class PointAdminController extends Controller
{
    public function __construct(private PointService $points)
    {
    }

    public function voidLog(Request $request, PointLog $log): JsonResponse
    {
        $balance = $this->points->void($log, $request->user());

        return response()->json([
            'points' => $balance->current_points,
            'message' => "Entry cancelled. Points are now {$balance->current_points}.",
        ]);
    }

    public function issueWarning(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'host_id' => 'required|exists:host_profiles,id',
            'level' => 'required|integer|between:1,3',
            'reason' => 'required|string|max:255',
        ]);

        $letter = $this->points->issueManual(
            HostProfile::findOrFail($validated['host_id']),
            $validated['level'],
            $validated['reason'],
            $request->user(),
        );

        return response()->json(['warning_letter' => $letter, 'message' => "SP{$letter->level} issued"], 201);
    }

    public function voidWarning(Request $request, WarningLetter $letter): JsonResponse
    {
        $this->points->voidWarning($letter, $request->user());

        return response()->json(['message' => "SP{$letter->level} cancelled"]);
    }
}
