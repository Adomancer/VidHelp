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
 * A host holding one block of a special event.
 * overridden = an admin/operator gave the block to someone else; cancelled = released.
 */
#[Fillable(['event_id', 'host_id', 'start_at', 'end_at', 'status', 'claimed_by', 'claimed_at'])]
class EventSlotClaim extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'start_at' => 'datetime',
            'end_at' => 'datetime',
            'claimed_at' => 'datetime',
        ];
    }

    #[Scope]
    protected function active(Builder $query): void
    {
        $query->where('status', 'active');
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(SpecialEvent::class, 'event_id');
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function claimer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'claimed_by');
    }
}
