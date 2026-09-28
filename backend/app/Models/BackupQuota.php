<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Cross-brand covers a host did in a month. Same-brand covers don't count.
 */
#[Fillable(['host_id', 'month_year', 'quota_used', 'quota_max'])]
class BackupQuota extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'quota_used' => 'integer',
            'quota_max' => 'integer',
        ];
    }

    /**
     * Read the quota without creating a row (unsaved default if none yet).
     */
    public static function peek(string $hostId, string $monthYear): self
    {
        return static::firstOrNew(
            ['host_id' => $hostId, 'month_year' => $monthYear],
            ['quota_used' => 0, 'quota_max' => config('vidhelp.backup.quota_per_month')]
        );
    }

    /**
     * The quota row for updating (created with the default max if missing).
     */
    public static function for(string $hostId, string $monthYear): self
    {
        return static::firstOrCreate(
            ['host_id' => $hostId, 'month_year' => $monthYear],
            ['quota_used' => 0, 'quota_max' => config('vidhelp.backup.quota_per_month')]
        );
    }

    public function isFull(): bool
    {
        return $this->quota_used >= $this->quota_max;
    }
}
