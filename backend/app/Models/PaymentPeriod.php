<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * One payment period of a brand: it runs (no end date yet) until the brand's target hours are reached
 * or finance closes it early, and the next one starts the day after it ends.
 * in_progress → (target reached or closed) waiting_payment → (the brand's leader requests payment, locked)
 * requested → paid. Cancelling the request unlocks it again (requested → waiting_payment).
 */
#[Fillable([
    'brand_id', 'period_start', 'period_end', 'target_hours', 'worked_hours', 'host_paid_hours', 'achieved_hours',
    'carried_in_hours', 'carried_out_hours', 'status', 'closed_at', 'closed_by', 'locked_at',
])]
class PaymentPeriod extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'period_start' => 'date:Y-m-d',
            'period_end' => 'date:Y-m-d',
            'target_hours' => 'integer',
            'worked_hours' => 'float',
            'host_paid_hours' => 'float',
            'achieved_hours' => 'float',
            'carried_in_hours' => 'float',
            'carried_out_hours' => 'float',
            'closed_at' => 'datetime',
            'locked_at' => 'datetime',
        ];
    }

    public function isLocked(): bool
    {
        return in_array($this->status, ['requested', 'paid']);
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    /** Who closed it before the target was reached; null when the target closed it. */
    public function closer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function workSessions(): HasMany
    {
        return $this->hasMany(WorkSession::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(PaymentItem::class);
    }

    public function adjustments(): HasMany
    {
        return $this->hasMany(HourAdjustment::class);
    }

    /** The live request (a period has at most one that isn't cancelled). */
    public function paymentRequest(): HasOne
    {
        return $this->hasOne(PaymentRequest::class)->where('status', '!=', 'cancelled');
    }

    /** Every request, cancelled ones included. */
    public function paymentRequests(): HasMany
    {
        return $this->hasMany(PaymentRequest::class)->latest('requested_at');
    }

    public function slips(): HasMany
    {
        return $this->hasMany(SalarySlip::class);
    }
}
