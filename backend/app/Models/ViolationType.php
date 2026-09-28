<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A kind of violation and how much it costs: points (per 3-month period) and rating (per month).
 * Types with a `code` are also applied automatically by the system.
 */
#[Fillable(['name', 'code', 'default_points', 'rating_impact', 'is_active'])]
class ViolationType extends Model
{
    use HasUuids;

    public const BACKUP_CANCEL = 'backup_cancel';

    public const LATE_SICK_LETTER = 'late_sick_letter';

    public const BRAND_COMPLAINT = 'brand_complaint';

    protected function casts(): array
    {
        return [
            'default_points' => 'integer',
            'rating_impact' => 'float',
            'is_active' => 'boolean',
        ];
    }

    /** The active type the system uses for an automatic penalty, if the admin kept it on. */
    public static function forCode(string $code): ?self
    {
        return static::where('code', $code)->where('is_active', true)->first();
    }
}
