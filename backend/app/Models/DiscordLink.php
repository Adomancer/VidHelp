<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Services\NotificationTypes;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A user's Discord account, linked through "Connect Discord" so the bot can DM them.
 * muted_categories: notification categories they don't want as DMs (the bell still shows them).
 */
#[Fillable(['user_id', 'discord_user_id', 'discord_username', 'dm_channel_id', 'muted_categories', 'dm_blocked_at', 'linked_at'])]
class DiscordLink extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'muted_categories' => 'array',
            'dm_blocked_at' => 'datetime',
            'linked_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Whether this notification type should reach them as a DM. */
    public function wants(string $type, string $category): bool
    {
        return NotificationTypes::critical($type) || ! in_array($category, $this->muted_categories ?? [], true);
    }
}
