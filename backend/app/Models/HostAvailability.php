<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A time range a host says they are free on a weekday. Planning aid only.
 */
#[Table('host_availability')]
#[Fillable(['host_id', 'day_of_week', 'available_from', 'available_to', 'note'])]
class HostAvailability extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'day_of_week' => 'integer',
        ];
    }

    /** "HH:MM" */
    protected function availableFrom(): Attribute
    {
        return self::hoursMinutes();
    }

    /** "HH:MM" */
    protected function availableTo(): Attribute
    {
        return self::hoursMinutes();
    }

    /** MySQL returns "14:00:00"; expose "14:00" everywhere. */
    private static function hoursMinutes(): Attribute
    {
        return Attribute::get(fn (?string $value) => $value === null ? null : substr($value, 0, 5));
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }
}
