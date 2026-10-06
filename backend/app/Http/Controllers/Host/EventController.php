<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\EventSlotClaim;
use App\Models\HostProfile;
use App\Models\SpecialEvent;
use App\Services\EventService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EventController extends Controller
{
    public function __construct(private EventService $events)
    {
    }

    /**
     * Running and upcoming events of my brands, with every block and whether I can claim it.
     * `my_brands` tells a host with no events which brands they'd see events for.
     */
    public function index(Request $request): JsonResponse
    {
        $host = $this->host($request);
        $brandIds = $host->assignments()->where('status', 'active')->pluck('brand_id');

        $events = SpecialEvent::query()
            ->with('brand:id,name')
            ->where('status', 'active')
            ->whereIn('brand_id', $brandIds)
            ->whereDate('end_date', '>=', today()->subDay())
            ->orderBy('start_date')
            ->get()
            ->map(fn (SpecialEvent $event) => [
                ...$event->toArray(),
                'my_claims' => EventSlotClaim::active()->where('event_id', $event->id)->where('host_id', $host->id)->count(),
                'blocks' => $this->events->blocks($event, $host),
            ]);

        return response()->json([
            'events' => $events,
            'my_brands' => Brand::whereIn('id', $brandIds)->orderBy('name')->pluck('name'),
        ]);
    }

    public function claim(Request $request, SpecialEvent $event): JsonResponse
    {
        $request->validate(['start_at' => 'required|date']);
        $host = $this->host($request);

        $claim = $this->events->claim($event, $host, $request->date('start_at'), $request->user());

        return response()->json(['claim' => $claim, 'message' => 'Blok diambil. Blok ini akan muncul di halaman Live pada harinya.'], 201);
    }

    public function cancel(Request $request, EventSlotClaim $claim): JsonResponse
    {
        abort_unless($claim->host_id === $this->host($request)->id, 403, 'Ini bukan blokmu.');

        $this->events->release($claim);

        return response()->json(['message' => 'Blok dilepas untuk host lain.']);
    }

    private function host(Request $request): HostProfile
    {
        return $request->user()->hostProfile ?? abort(404, 'Kamu tidak punya profil host.');
    }
}
