<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Hours (and sessions) an admin adds to or removes from a host in a period, with a reason.
 */
#[Fillable(['payment_period_id', 'host_id', 'sessions_added', 'hours_added', 'notes', 'created_by'])]
class HourAdjustment extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'sessions_added' => 'integer',
            'hours_added' => 'float',
        ];
    }

    public function period(): BelongsTo
    {
        return $this->belongsTo(PaymentPeriod::class, 'payment_period_id');
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
