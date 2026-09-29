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
 * One payment cycle of a brand.
 * in_progress → (period ends) waiting_payment → (admin requests payment, locked) requested → paid.
 */
#[Fillable([
    'brand_id', 'period_start', 'period_end', 'target_hours', 'worked_hours', 'achieved_hours',
    'carried_in_hours', 'carried_out_hours', 'status', 'locked_at',
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
            'achieved_hours' => 'float',
            'carried_in_hours' => 'float',
            'carried_out_hours' => 'float',
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

    public function paymentRequest(): HasOne
    {
        return $this->hasOne(PaymentRequest::class);
    }

    public function slips(): HasMany
    {
        return $this->hasMany(SalarySlip::class);
    }
}
