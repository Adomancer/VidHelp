<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\BackupRequest;
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

        $nextWeek = fn () => BackupRequest::query()
            ->where('end_at', '>', now())
            ->where('start_at', '<', today()->addDays(7));

        return response()->json([
            'slots' => $mine()->activeOn(today())->get(),
            'upcoming' => $mine()->where('status', 'active')->whereDate('effective_from', '>', today())->get(),

            // Backups I'm covering for someone else in the next 7 days
            'covers' => $nextWeek()
                ->where('status', 'filled')
                ->where('filled_by_host_id', $profile->id)
                ->with(['brand:id,name', 'requester.user'])
                ->orderBy('start_at')
                ->get()
                ->map(fn (BackupRequest $backup) => $backup->publicSummary()),

            // My own sessions in the next 7 days that someone else covers (or is being arranged)
            'absences' => $nextWeek()
                ->whereIn('status', ['pending', 'open', 'filled'])
                ->where('requesting_host_id', $profile->id)
                ->with('filler.user')
                ->get()
                ->map(fn (BackupRequest $backup) => $backup->slotMarker()),
        ]);
    }
}
