<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A host's pay for one paid period: gross, kasbon deducted, net.
 */
#[Fillable([
    'host_id', 'payment_period_id', 'gross_amount', 'advance_deduction', 'net_amount',
    'pdf_path', 'generated_at', 'sent_at',
])]
class SalarySlip extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'gross_amount' => 'float',
            'advance_deduction' => 'float',
            'net_amount' => 'float',
            'generated_at' => 'datetime',
            'sent_at' => 'datetime',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function period(): BelongsTo
    {
        return $this->belongsTo(PaymentPeriod::class, 'payment_period_id');
    }

    public function deductions(): HasMany
    {
        return $this->hasMany(CashAdvanceInstallment::class);
    }
}
