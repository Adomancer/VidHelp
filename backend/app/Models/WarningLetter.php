<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * SP1-SP3. Issued automatically when points cross a threshold, or by an admin.
 */
#[Fillable([
    'host_id', 'point_log_id', 'level', 'period_start', 'reason',
    'issued_by', 'issued_at', 'voided_at', 'voided_by',
])]
class WarningLetter extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'level' => 'integer',
            'period_start' => 'date:Y-m-d',
            'issued_at' => 'datetime',
            'voided_at' => 'datetime',
        ];
    }

    #[Scope]
    protected function counting(Builder $query): void
    {
        $query->whereNull('voided_at');
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function pointLog(): BelongsTo
    {
        return $this->belongsTo(PointLog::class);
    }

    public function issuer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'issued_by');
    }
}
