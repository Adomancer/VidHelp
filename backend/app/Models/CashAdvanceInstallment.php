<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'cash_advance_id', 'payment_period_id', 'salary_slip_id', 'seq', 'amount',
    'deducted_brand_id', 'status', 'deducted_at',
])]
class CashAdvanceInstallment extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'seq' => 'integer',
            'amount' => 'float',
            'deducted_at' => 'datetime',
        ];
    }

    public function advance(): BelongsTo
    {
        return $this->belongsTo(CashAdvance::class, 'cash_advance_id');
    }

    public function slip(): BelongsTo
    {
        return $this->belongsTo(SalarySlip::class, 'salary_slip_id');
    }
}
