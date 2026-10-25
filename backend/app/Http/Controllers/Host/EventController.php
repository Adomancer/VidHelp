<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\EventSlotClaim;
use App\Models\HostProfile;
use App\Models\SpecialEvent;
use App\Services\EventService;
use App\Services\HostCalendar;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EventController extends Controller
{
    public function __construct(private EventService $events, private HostCalendar $calendar) {}

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
            ->withCount(['claims as my_claims' => fn ($q) => $q->active()->where('host_id', $host->id)])
            ->where('status', 'active')
            ->whereIn('brand_id', $brandIds)
            ->whereDate('end_date', '>=', today()->subDay())
            ->orderBy('start_date')
            ->get();

        // When I'm busy, worked out once for the days of every event (from the first one's opening
        // to two days after the last one's last day: hours may run past midnight)
        $busy = $events->isEmpty() ? collect() : $this->calendar->hostIntervals(
            $host,
            CarbonImmutable::parse($events->min('start_date'))->startOfDay(),
            CarbonImmutable::parse($events->max('end_date'))->addDays(2)->startOfDay(),
        );

        $events = $events->map(fn (SpecialEvent $event) => [
            ...$event->toArray(),
            'blocks' => $this->events->blocks($event, $host, $busy),
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
