<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A client brand. Its pay periods start on `payroll_start_date`, and each one runs until
 * `target_hours_per_period` hours are reached; the brand's leader host then requests payment.
 */
#[Fillable(['name', 'is_obs', 'product_knowledge', 'target_hours_per_period', 'payroll_start_date', 'status'])]
class Brand extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'is_obs' => 'boolean',
            'target_hours_per_period' => 'integer',
            'payroll_start_date' => 'date:Y-m-d',
        ];
    }

    public function paymentPeriods(): HasMany
    {
        return $this->hasMany(PaymentPeriod::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(HostBrandAssignment::class);
    }
}
