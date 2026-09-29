<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * A complaint a brand made about a host. Recording it also deducts points.
 */
#[Fillable(['host_id', 'brand_id', 'description', 'recorded_by'])]
class BrandComplaint extends Model
{
    use Auditable, HasUuids;

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public function pointLog(): HasOne
    {
        return $this->hasOne(PointLog::class);
    }
}
