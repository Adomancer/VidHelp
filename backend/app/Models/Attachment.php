<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * A private file attached to a record (sick letter on a backup request, ...).
 */
#[Fillable(['owner_type', 'owner_id', 'file_path', 'original_name', 'mime_type', 'size_kb', 'uploaded_by'])]
#[Hidden(['file_path'])]
class Attachment extends Model
{
    use HasUuids;

    public function owner(): MorphTo
    {
        return $this->morphTo();
    }
}
