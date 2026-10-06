<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\EventSlotClaim;
use App\Models\HostProfile;
use App\Models\SpecialEvent;
use App\Services\EventService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class EventController extends Controller
{
    public function __construct(private EventService $events)
    {
    }

    /**
     * Events that are running, upcoming, or ended in the last 30 days.
     */
    public function index(Request $request): JsonResponse
    {
        $events = SpecialEvent::query()
            ->with('brand:id,name')
            ->withCount(['claims as claimed_blocks' => fn ($q) => $q->where('status', 'active')])
            ->when($request->brand_id, fn ($q, $id) => $q->where('brand_id', $id))
            ->whereDate('end_date', '>=', today()->subDays(30))
            ->orderBy('start_date')
            ->get()
            ->map(fn (SpecialEvent $event) => [...$event->toArray(), 'total_blocks' => count($event->blocks())]);

        return response()->json(['events' => $events]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'brand_id' => ['required', Rule::exists('brands', 'id')->where('status', 'active')],
            'name' => 'required|string|max:100',
            'start_date' => 'required|date_format:Y-m-d|after_or_equal:today',
            'end_date' => 'required|date_format:Y-m-d|after_or_equal:start_date',
            'daily_start_time' => 'required|date_format:H:i',
            'daily_end_time' => 'required|date_format:H:i|different:daily_start_time',
            'block_minutes' => 'required|integer|min:15|max:720',
            'open_full_schedule' => 'boolean',
            'max_slots_per_host' => 'required|integer|min:1|max:100',
        ]);

        $event = $this->events->create($validated, $request->user());

        return response()->json(['event' => $event, 'message' => 'Event dibuat. Host dari brand ini sekarang bisa mengambil blok.'], 201);
    }

    /**
     * The event with its block grid.
     */
    public function show(SpecialEvent $event): JsonResponse
    {
        return response()->json([
            'event' => $event->load('brand:id,name'),
            'blocks' => $this->events->blocks($event),
        ]);
    }

    /**
     * Name, per-host limit and whether it replaces the regular schedule. Dates and hours
     * can't change once blocks exist (cancel and recreate instead).
     */
    public function update(Request $request, SpecialEvent $event): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:100',
            'open_full_schedule' => 'sometimes|boolean',
            'max_slots_per_host' => 'sometimes|integer|min:1|max:100',
        ]);

        return response()->json(['event' => $this->events->update($event, $validated), 'message' => 'Event diperbarui']);
    }

    public function cancel(SpecialEvent $event): JsonResponse
    {
        $this->events->cancel($event);

        return response()->json(['message' => 'Event dibatalkan; semua blok yang sudah diambil dilepas.']);
    }

    /**
     * Give a block to a host, taking it over if someone else holds it.
     */
    public function assign(Request $request, SpecialEvent $event): JsonResponse
    {
        $validated = $request->validate([
            'start_at' => 'required|date',
            'host_id' => 'required|exists:host_profiles,id',
        ]);

        $claim = $this->events->claim(
            $event,
            HostProfile::findOrFail($validated['host_id']),
            $request->date('start_at'),
            $request->user(),
            asManager: true,
        );

        return response()->json(['claim' => $claim, 'message' => 'Blok ditugaskan'], 201);
    }

    public function release(EventSlotClaim $claim): JsonResponse
    {
        $this->events->release($claim, asManager: true);

        return response()->json(['message' => 'Blok dilepas']);
    }
}
