<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A host's pay for one locked period: hours at the rate snapshotted when payment was requested.
 * hours = what is paid now: carried in + worked, less what carried out (over the brand's target).
 */
#[Fillable([
    'payment_period_id', 'host_id', 'session_count', 'carried_in_hours', 'worked_hours', 'hours', 'carried_out_hours',
    'rate_per_hour', 'amount',
])]
class PaymentItem extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'session_count' => 'integer',
            'carried_in_hours' => 'float',
            'worked_hours' => 'float',
            'hours' => 'float',
            'carried_out_hours' => 'float',
            'rate_per_hour' => 'float',
            'amount' => 'float',
        ];
    }

    public function period(): BelongsTo
    {
        return $this->belongsTo(PaymentPeriod::class, 'payment_period_id');
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }
}
