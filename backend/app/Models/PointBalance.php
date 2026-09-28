<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A host's points for one points period (3 months by default), starting at 100.
 */
#[Fillable(['host_id', 'period_start', 'period_end', 'opening_points', 'current_points'])]
class PointBalance extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'period_start' => 'date:Y-m-d',
            'period_end' => 'date:Y-m-d',
            'opening_points' => 'integer',
            'current_points' => 'integer',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }
}
