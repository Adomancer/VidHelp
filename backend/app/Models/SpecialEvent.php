<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A brand event (PD, double date) whose hours are split into fixed blocks hosts claim.
 * With open_full_schedule the brand's regular slots don't run on the event days.
 */
#[Fillable([
    'brand_id', 'name', 'start_date', 'end_date', 'daily_start_time', 'daily_end_time',
    'block_minutes', 'open_full_schedule', 'max_slots_per_host', 'status', 'created_by',
])]
class SpecialEvent extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'start_date' => 'date:Y-m-d',
            'end_date' => 'date:Y-m-d',
            'block_minutes' => 'integer',
            'open_full_schedule' => 'boolean',
            'max_slots_per_host' => 'integer',
        ];
    }

    /** "HH:MM" */
    protected function dailyStartTime(): Attribute
    {
        return Attribute::get(fn (?string $value) => $value === null ? null : substr($value, 0, 5));
    }

    /** "HH:MM" */
    protected function dailyEndTime(): Attribute
    {
        return Attribute::get(fn (?string $value) => $value === null ? null : substr($value, 0, 5));
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public function claims(): HasMany
    {
        return $this->hasMany(EventSlotClaim::class, 'event_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function coversDate(CarbonInterface|string $date): bool
    {
        $day = CarbonImmutable::parse($date)->toDateString();

        return $this->start_date->toDateString() <= $day && $this->end_date->toDateString() >= $day;
    }

    /**
     * The event's opening hours on a day; the close is the next day when it runs past midnight.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    public function windowOn(CarbonInterface $day): array
    {
        $open = CarbonImmutable::parse($day->toDateString().' '.$this->daily_start_time);
        $close = CarbonImmutable::parse($day->toDateString().' '.$this->daily_end_time);

        return [$open, $close->lte($open) ? $close->addDay() : $close];
    }

    /**
     * Every claimable block, day by day. The last block of a day is shorter if the hours don't divide evenly.
     *
     * @return list<array{0: CarbonImmutable, 1: CarbonImmutable}>
     */
    public function blocks(): array
    {
        $blocks = [];

        for ($day = CarbonImmutable::parse($this->start_date->toDateString()); $day->lte($this->end_date); $day = $day->addDay()) {
            [$open, $close] = $this->windowOn($day);

            for ($start = $open; $start->lt($close); $start = $start->addMinutes($this->block_minutes)) {
                $end = $start->addMinutes($this->block_minutes);
                $blocks[] = [$start, $end->gt($close) ? $close : $end];
            }
        }

        return $blocks;
    }

    /**
     * The block starting exactly at `$start`, if there is one.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}|null
     */
    public function blockAt(CarbonInterface $start): ?array
    {
        foreach ($this->blocks() as $block) {
            if ($block[0]->equalTo($start)) {
                return $block;
            }
        }

        return null;
    }
}
