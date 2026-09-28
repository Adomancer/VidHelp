<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\ScheduleSlot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MyScheduleController extends Controller
{
    /**
     * My weekly slots across all brands: the ones in effect today, plus ones
     * that start later (e.g. a schedule change from next week).
     */
    public function index(Request $request): JsonResponse
    {
        $profile = $request->user()->hostProfile;

        if (! $profile) {
            return response()->json(['slots' => [], 'upcoming' => []]);
        }

        $mine = fn () => ScheduleSlot::query()
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $profile->id))
            ->with('assignment.brand:id,name,is_obs')
            ->orderBy('day_of_week')
            ->orderBy('start_time');

        return response()->json([
            'slots' => $mine()->activeOn(today())->get(),
            'upcoming' => $mine()->where('status', 'active')->whereDate('effective_from', '>', today())->get(),
        ]);
    }
}
