<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\BackupRequest;
use App\Models\EventSlotClaim;
use App\Models\ScheduleSlot;
use App\Models\SpecialEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MyScheduleController extends Controller
{
    /**
     * My weekly slots across all brands: the ones in effect today, plus ones
     * that start later (e.g. a schedule change from next week). Backups and
     * event blocks cover the next `days` days (7 by default, up to six weeks
     * for the calendar).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['days' => 'nullable|integer|between:1,42']);
        $until = today()->addDays($request->integer('days') ?: 7);
        $profile = $request->user()->hostProfile;

        if (! $profile) {
            return response()->json([
                'slots' => [], 'upcoming' => [], 'covers' => [], 'absences' => [], 'event_claims' => [], 'replacing_events' => [],
            ]);
        }

        $mine = fn () => ScheduleSlot::query()
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $profile->id))
            ->with('assignment.brand:id,name,is_obs')
            ->orderBy('day_of_week')
            ->orderBy('start_time');

        $ahead = fn () => BackupRequest::query()
            ->where('end_at', '>', now())
            ->where('start_at', '<', $until);

        return response()->json([
            'slots' => $mine()->activeOn(today())->get(),
            'upcoming' => $mine()->where('status', 'active')->whereDate('effective_from', '>', today())->get(),

            // Backups I'm covering for someone else in that range
            'covers' => $ahead()
                ->where('status', 'filled')
                ->where('filled_by_host_id', $profile->id)
                ->with(['brand:id,name', 'requester.user'])
                ->orderBy('start_at')
                ->get()
                ->map(fn (BackupRequest $backup) => $backup->publicSummary()),

            // My own sessions in that range that someone else covers (or is being arranged)
            'absences' => $ahead()
                ->whereIn('status', ['pending', 'open', 'filled'])
                ->where('requesting_host_id', $profile->id)
                ->with('filler.user')
                ->get()
                ->map(fn (BackupRequest $backup) => $backup->slotMarker()),

            // Event blocks I claimed in that range
            'event_claims' => EventSlotClaim::active()
                ->where('host_id', $profile->id)
                ->where('end_at', '>', now())
                ->where('start_at', '<', $until)
                ->with('event:id,name,brand_id', 'event.brand:id,name')
                ->orderBy('start_at')
                ->get()
                ->map(fn (EventSlotClaim $claim) => [
                    'id' => $claim->id,
                    'event_name' => $claim->event->name,
                    'brand' => $claim->event->brand->only('id', 'name'),
                    'date' => $claim->start_at->toDateString(),
                    'start_at' => $claim->start_at,
                    'end_at' => $claim->end_at,
                ]),

            // Events replacing my brands' regular schedule on some days in that range
            'replacing_events' => SpecialEvent::query()
                ->where('status', 'active')
                ->where('open_full_schedule', true)
                ->whereIn('brand_id', $profile->assignments()->where('status', 'active')->pluck('brand_id'))
                ->whereDate('start_date', '<', $until)
                ->whereDate('end_date', '>=', today())
                ->get(['id', 'brand_id', 'name', 'start_date', 'end_date']),
        ]);
    }
}
