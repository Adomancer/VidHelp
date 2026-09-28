<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'min_tenure_months', 'rate_per_hour'])]
class HostRateCategory extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'min_tenure_months' => 'integer',
            'rate_per_hour' => 'decimal:2',
        ];
    }

    public function hosts(): HasMany
    {
        return $this->hasMany(HostProfile::class, 'rate_category_id');
    }

    /**
     * The highest category a host with this many months of tenure qualifies for.
     */
    public static function forTenure(int $months): ?self
    {
        return static::where('min_tenure_months', '<=', $months)
            ->orderByDesc('min_tenure_months')
            ->first();
    }
}
