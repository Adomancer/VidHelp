<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable([
    'user_id', 'rate_category_id', 'rate_category_overridden',
    'phone', 'guardian_phone', 'join_date', 'status',
])]
class HostProfile extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'join_date' => 'date:Y-m-d',
            'rate_category_overridden' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function rateCategory(): BelongsTo
    {
        return $this->belongsTo(HostRateCategory::class, 'rate_category_id');
    }

    public function sensitiveData(): HasOne
    {
        return $this->hasOne(HostSensitiveData::class, 'host_id');
    }

    public function availability(): HasMany
    {
        return $this->hasMany(HostAvailability::class, 'host_id')->orderBy('day_of_week')->orderBy('available_from');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(HostBrandAssignment::class, 'host_id');
    }

    /**
     * Whole months since join_date (0 for a future join date).
     */
    public function tenureMonths(): int
    {
        return max(0, (int) floor($this->join_date->diffInMonths(today())));
    }

    /**
     * Move the host to the rate category matching their tenure, unless an admin
     * set it by hand. Does not save.
     */
    public function syncRateCategory(): void
    {
        if ($this->rate_category_overridden) {
            return;
        }

        $this->rate_category_id = HostRateCategory::forTenure($this->tenureMonths())?->id;
    }

    /**
     * Re-place every automatically managed host. Returns how many changed level.
     */
    public static function syncAllRateCategories(): int
    {
        $changed = 0;

        static::where('rate_category_overridden', false)->lazyById()->each(function (HostProfile $host) use (&$changed) {
            $host->syncRateCategory();
            if ($host->isDirty('rate_category_id')) {
                $host->save();
                $changed++;
            }
        });

        return $changed;
    }
}
