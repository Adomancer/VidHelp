<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * What the host reports after a session. Approved reports become a WorkSession (paid hours).
 */
#[Fillable([
    'attendance_id', 'host_id', 'brand_id', 'session_count', 'duration_hours', 'metrics', 'notes',
    'status', 'flag_reasons', 'submitted_at', 'reviewed_by', 'reviewed_at', 'review_note',
])]
class LiveReport extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'session_count' => 'integer',
            'duration_hours' => 'float',
            'metrics' => 'array',
            'flag_reasons' => 'array',
            'submitted_at' => 'datetime',
            'reviewed_at' => 'datetime',
        ];
    }

    public function attendance(): BelongsTo
    {
        return $this->belongsTo(Attendance::class);
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    public function workSession(): HasOne
    {
        return $this->hasOne(WorkSession::class);
    }
}
