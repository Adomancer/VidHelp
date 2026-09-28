<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'is_obs', 'target_hours_per_period', 'payment_cycle_days', 'payroll_start_date', 'status'])]
class Brand extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'is_obs' => 'boolean',
            'target_hours_per_period' => 'integer',
            'payment_cycle_days' => 'integer',
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
