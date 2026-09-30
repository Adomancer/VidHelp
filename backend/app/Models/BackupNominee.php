<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A host the requester named for a direct backup request; only nominees may apply to it.
 */
#[Fillable(['backup_request_id', 'nominee_host_id'])]
class BackupNominee extends Model
{
    use HasUuids;

    public function request(): BelongsTo
    {
        return $this->belongsTo(BackupRequest::class, 'backup_request_id');
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'nominee_host_id');
    }
}
