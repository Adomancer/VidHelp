<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * A host's check-in/out for one session occurrence (their own slot, or a backup they cover).
 */
#[Fillable([
    'host_id', 'slot_id', 'backup_request_id', 'brand_id', 'session_date',
    'scheduled_start_at', 'scheduled_end_at', 'check_in_at', 'check_out_at', 'report_due_at',
])]
class Attendance extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'session_date' => 'date:Y-m-d',
            'scheduled_start_at' => 'datetime',
            'scheduled_end_at' => 'datetime',
            'check_in_at' => 'datetime',
            'check_out_at' => 'datetime',
            'report_due_at' => 'datetime',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function slot(): BelongsTo
    {
        return $this->belongsTo(ScheduleSlot::class, 'slot_id');
    }

    public function backupRequest(): BelongsTo
    {
        return $this->belongsTo(BackupRequest::class);
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public function report(): HasOne
    {
        return $this->hasOne(LiveReport::class);
    }

    public function scheduledHours(): float
    {
        return round($this->scheduled_start_at->diffInMinutes($this->scheduled_end_at) / 60, 2);
    }

    /** Hours between check-in and check-out, or null if not checked out. */
    public function attendedHours(): ?float
    {
        return $this->check_out_at ? round($this->check_in_at->diffInMinutes($this->check_out_at) / 60, 2) : null;
    }
}
