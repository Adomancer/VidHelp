<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * A weekly recurring live slot for one host on one brand (via the assignment),
 * valid between effective_from and effective_to.
 */
#[Fillable([
    'assignment_id', 'day_of_week', 'slot_type', 'start_time', 'end_time',
    'is_locked', 'status', 'effective_from', 'effective_to',
])]
class ScheduleSlot extends Model
{
    use Auditable, HasUuids;

    private const DAY_MINUTES = 1440;

    private const WEEK_MINUTES = 7 * self::DAY_MINUTES;

    private const DAY_NAMES = [1 => 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    protected function casts(): array
    {
        return [
            'day_of_week' => 'integer',
            'crosses_midnight' => 'boolean',
            'is_locked' => 'boolean',
            'effective_from' => 'date:Y-m-d',
            'effective_to' => 'date:Y-m-d',
        ];
    }

    protected static function booted(): void
    {
        // Derived: 23:00 - 01:00 ends on the next day
        static::saving(function (ScheduleSlot $slot) {
            $slot->crosses_midnight = self::minutes($slot->end_time) <= self::minutes($slot->start_time);
        });
    }

    /** "HH:MM" */
    protected function startTime(): Attribute
    {
        return self::hoursMinutes();
    }

    /** "HH:MM" */
    protected function endTime(): Attribute
    {
        return self::hoursMinutes();
    }

    /** MySQL returns "14:00:00"; expose "14:00" everywhere. */
    private static function hoursMinutes(): Attribute
    {
        return Attribute::get(fn (?string $value) => $value === null ? null : substr($value, 0, 5));
    }

    public function assignment(): BelongsTo
    {
        return $this->belongsTo(HostBrandAssignment::class, 'assignment_id');
    }

    /**
     * Slots in effect on a given date.
     */
    #[Scope]
    protected function activeOn(Builder $query, Carbon|string $date): void
    {
        $query->where('status', 'active')
            ->whereDate('effective_from', '<=', $date)
            ->where(fn ($q) => $q->whereNull('effective_to')->orWhereDate('effective_to', '>=', $date));
    }

    /**
     * Slots whose effective period shares at least one day with [from, to] (to null = open-ended).
     */
    #[Scope]
    protected function activeDuring(Builder $query, Carbon|string $from, Carbon|string|null $to): void
    {
        $query->where('status', 'active')
            ->where(fn ($q) => $q->whereNull('effective_to')->orWhereDate('effective_to', '>=', $from))
            ->when($to, fn ($q) => $q->whereDate('effective_from', '<=', $to));
    }

    /**
     * Other active slots this one would clash with: same brand (one host live at a time)
     * or same host (can't be in two places), overlapping in both time of week and period.
     */
    public function conflicts(): Collection
    {
        $assignment = $this->assignment;

        return static::query()
            ->with(['assignment.brand', 'assignment.host.user'])
            ->when($this->exists, fn ($q) => $q->whereKeyNot($this->getKey()))
            ->activeDuring($this->effective_from, $this->effective_to)
            ->whereHas('assignment', fn ($q) => $q
                ->where('brand_id', $assignment->brand_id)
                ->orWhere('host_id', $assignment->host_id))
            ->get()
            ->filter(fn (ScheduleSlot $other) => $this->overlaps($other))
            ->values();
    }

    /**
     * Whether this weekly slot runs on the given date (right weekday, in its effective period).
     */
    public function runsOn(CarbonInterface $date): bool
    {
        return $this->status === 'active'
            && $date->dayOfWeekIso === $this->day_of_week
            && $this->effective_from->lte($date->toDateString())
            && ($this->effective_to === null || $this->effective_to->gte($date->toDateString()));
    }

    /**
     * Concrete [start, end] of the slot on a date; overnight slots end the next day.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    public function occurrenceOn(CarbonInterface $date): array
    {
        $start = CarbonImmutable::parse($date->toDateString().' '.$this->start_time);
        $end = CarbonImmutable::parse($date->toDateString().' '.$this->end_time);

        return [$start, $end->lte($start) ? $end->addDay() : $end];
    }

    public function overlaps(ScheduleSlot $other): bool
    {
        [$start, $end] = $this->weekRange();
        [$otherStart, $otherEnd] = $other->weekRange();

        // Shift by a week so Sunday 23:00-01:00 also collides with Monday 00:30
        foreach ([-self::WEEK_MINUTES, 0, self::WEEK_MINUTES] as $shift) {
            if ($start < $otherEnd + $shift && $otherStart + $shift < $end) {
                return true;
            }
        }

        return false;
    }

    /**
     * [start, end) in minutes since Monday 00:00.
     */
    public function weekRange(): array
    {
        $dayStart = ($this->day_of_week - 1) * self::DAY_MINUTES;
        $start = $dayStart + self::minutes($this->start_time);
        $end = $dayStart + self::minutes($this->end_time);

        return [$start, $end <= $start ? $end + self::DAY_MINUTES : $end];
    }

    /** "Mon 23:00-01:00" */
    public function label(): string
    {
        return self::DAY_NAMES[$this->day_of_week].' '.$this->start_time.'-'.$this->end_time;
    }

    /**
     * Stop the slot from today on. Slots that haven't started yet are deleted;
     * ones that already ran keep their history and just end yesterday.
     */
    public function retire(): void
    {
        if ($this->effective_from->gte(today())) {
            $this->delete();

            return;
        }

        if ($this->effective_to === null || $this->effective_to->gte(today())) {
            $this->update(['effective_to' => today()->subDay()]);
        }
    }

    /** "14:30" or "14:30:00" → 870 */
    public static function minutes(string $time): int
    {
        [$hours, $minutes] = explode(':', $time);

        return (int) $hours * 60 + (int) $minutes;
    }
}
