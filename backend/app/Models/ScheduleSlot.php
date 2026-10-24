<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A weekly recurring live slot for one host on one brand (via the assignment),
 * valid between effective_from and effective_to.
 */
#[Fillable([
    'assignment_id', 'previous_slot_id', 'day_of_week', 'slot_type', 'start_time', 'end_time',
    'is_locked', 'status', 'effective_from', 'effective_to',
])]
class ScheduleSlot extends Model
{
    use Auditable, HasUuids;

    private const DAY_MINUTES = 1440;

    private const WEEK_MINUTES = 7 * self::DAY_MINUTES;

    private const DAY_NAMES = [1 => 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

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

    /** The slot this one continues after an edit that applied from a later date. */
    public function previous(): BelongsTo
    {
        return $this->belongsTo(self::class, 'previous_slot_id');
    }

    /**
     * This slot's id and those of the slots it continues, newest first.
     *
     * @return list<string>
     */
    public function lineageIds(): array
    {
        $ids = [$this->id];
        $previousId = $this->previous_slot_id;

        // Bounded so a broken chain can't loop forever
        while ($previousId && count($ids) < 50 && ! in_array($previousId, $ids, true)) {
            $ids[] = $previousId;
            $previousId = static::whereKey($previousId)->value('previous_slot_id');
        }

        return $ids;
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
    public function conflicts(?string $ignoreId = null): Collection
    {
        $assignment = $this->assignment;
        $ignoreId ??= $this->exists ? $this->getKey() : null;

        return static::query()
            ->with(['assignment.brand', 'assignment.host.user'])
            ->when($ignoreId, fn ($q) => $q->whereKeyNot($ignoreId))
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
     * Stop the slot from a date on (default today). Slots that haven't started by then
     * are deleted; ones that already ran keep their history and end the day before.
     * A slot that hasn't started but already has a check-in or a backup request is made
     * inactive instead, so those rows (and the paid hours behind them) stay.
     */
    public function retire(?CarbonInterface $from = null): void
    {
        $from = Carbon::parse($from ?? today())->startOfDay();

        if ($this->effective_from->gte($from)) {
            if ($this->isUsed()) {
                $this->update(['status' => 'inactive']);
            } else {
                $this->delete();
            }

            return;
        }

        if ($this->effective_to === null || $this->effective_to->gte($from)) {
            $this->update(['effective_to' => $from->copy()->subDay()]);
        }
    }

    /** Someone checked in on it or asked for a backup on it (the database won't let it be deleted). */
    public function isUsed(): bool
    {
        return Attendance::where('slot_id', $this->id)->exists()
            || BackupRequest::where('slot_id', $this->id)->exists();
    }

    /** "14:30" or "14:30:00" → 870 */
    public static function minutes(string $time): int
    {
        [$hours, $minutes] = explode(':', $time);

        return (int) $hours * 60 + (int) $minutes;
    }
}
