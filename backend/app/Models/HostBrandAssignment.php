<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['host_id', 'brand_id', 'is_leader', 'status'])]
class HostBrandAssignment extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'is_leader' => 'boolean',
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

    public function slots(): HasMany
    {
        return $this->hasMany(ScheduleSlot::class, 'assignment_id');
    }
}
