<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The admin's monthly rating of a host (1.0-5.0).
 */
#[Fillable(['host_id', 'month_year', 'rating', 'suggested_rating', 'note', 'rated_by'])]
class HostRating extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'rating' => 'float',
            'suggested_rating' => 'float',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function rater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rated_by');
    }
}
