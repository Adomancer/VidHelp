<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The agency asking the brand to pay a locked period.
 */
#[Fillable([
    'payment_period_id', 'requested_by', 'requested_at', 'status', 'exported_report_url', 'paid_at',
    'cancelled_at', 'cancelled_by', 'cancel_reason',
])]
class PaymentRequest extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'requested_at' => 'datetime',
            'paid_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function period(): BelongsTo
    {
        return $this->belongsTo(PaymentPeriod::class, 'payment_period_id');
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function canceller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'cancelled_by');
    }
}
