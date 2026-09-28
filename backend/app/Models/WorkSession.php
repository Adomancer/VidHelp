<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Validated, payable live hours. Payroll sums these per payment period.
 */
#[Fillable([
    'live_report_id', 'host_id', 'brand_id', 'payment_period_id', 'session_date',
    'start_at', 'end_at', 'duration_hours', 'session_type', 'status', 'notes',
])]
class WorkSession extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'session_date' => 'date:Y-m-d',
            'start_at' => 'datetime',
            'end_at' => 'datetime',
            'duration_hours' => 'float',
        ];
    }

    public function liveReport(): BelongsTo
    {
        return $this->belongsTo(LiveReport::class);
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }
}
