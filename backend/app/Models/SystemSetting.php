<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An admin's override of one config/vidhelp.php value (key = path under "vidhelp").
 */
#[Fillable(['key', 'value', 'updated_by'])]
class SystemSetting extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'value' => 'json',
        ];
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by')->withTrashed();
    }
}
