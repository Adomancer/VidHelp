<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A user's Discord account, linked through "Connect Discord" so the bot can DM them.
 */
#[Fillable(['user_id', 'discord_user_id', 'discord_username', 'dm_channel_id', 'linked_at'])]
class DiscordLink extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'linked_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
