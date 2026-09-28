<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The agency asking the brand to pay a locked period.
 */
#[Fillable(['payment_period_id', 'requested_by', 'requested_at', 'status', 'exported_report_url', 'paid_at'])]
class PaymentRequest extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'requested_at' => 'datetime',
            'paid_at' => 'datetime',
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
}
