<?php

namespace App\Services;

use App\Models\SpecialEvent;
use Carbon\CarbonInterface;

/**
 * Which days a brand's regular schedule is replaced by a special event
 * ("schedule opened empty"). Caches per instance, i.e. per request.
 */
class EventCalendar
{
    /** @var array<string, \Illuminate\Support\Collection<int, SpecialEvent>> */
    private array $fullEvents = [];

    /**
     * The active event that replaces the brand's regular slots on this date, if any.
     */
    public function replacing(string $brandId, CarbonInterface|string $date): ?SpecialEvent
    {
        $this->fullEvents[$brandId] ??= SpecialEvent::where('brand_id', $brandId)
            ->where('status', 'active')
            ->where('open_full_schedule', true)
            ->get();

        return $this->fullEvents[$brandId]->first(fn (SpecialEvent $event) => $event->coversDate($date));
    }
}
