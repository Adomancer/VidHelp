<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Kasbon: money a host gets ahead of pay (early payment or loan), paid back in
 * installments deducted from their next salary slips, or settled in cash/transfer.
 */
#[Fillable([
    'host_id', 'brand_id', 'type', 'total_amount', 'installment_count', 'notes', 'status', 'recorded_by', 'requested_at',
    'settled_at', 'settled_by', 'settled_note',
])]
class CashAdvance extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'total_amount' => 'float',
            'installment_count' => 'integer',
            'requested_at' => 'datetime',
            'settled_at' => 'datetime',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public function installments(): HasMany
    {
        return $this->hasMany(CashAdvanceInstallment::class)->orderBy('seq');
    }

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }

    public function settler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'settled_by');
    }
}
