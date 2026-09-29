<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One change to a host's points (negative = deduction). Voided logs no longer count.
 */
#[Fillable([
    'host_id', 'violation_type_id', 'brand_complaint_id', 'source', 'points_change', 'reason',
    'recorded_by', 'period_start', 'occurred_on', 'voided_at', 'voided_by',
])]
class PointLog extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'points_change' => 'integer',
            'period_start' => 'date:Y-m-d',
            'occurred_on' => 'date:Y-m-d',
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

    public function violationType(): BelongsTo
    {
        return $this->belongsTo(ViolationType::class);
    }

    public function brandComplaint(): BelongsTo
    {
        return $this->belongsTo(BrandComplaint::class);
    }

    public function recorder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
