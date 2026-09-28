<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A host offering to cover a backup request.
 * cancelled = dropped after being picked (penalty pending until penalty_applied).
 */
#[Fillable(['backup_request_id', 'applicant_host_id', 'status', 'penalty_applied', 'decided_at'])]
class BackupApplication extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'penalty_applied' => 'boolean',
            'decided_at' => 'datetime',
        ];
    }

    public function request(): BelongsTo
    {
        return $this->belongsTo(BackupRequest::class, 'backup_request_id');
    }

    public function applicant(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'applicant_host_id');
    }
}
