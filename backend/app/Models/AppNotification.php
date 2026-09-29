<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One delivery of a notification: in-app (web), a Discord channel post, or a Discord DM.
 */
#[Table('notifications')]
#[Fillable([
    'user_id', 'type', 'title', 'body', 'link', 'payload', 'channel', 'target',
    'status', 'attempts', 'error', 'sent_at', 'read_at',
])]
class AppNotification extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'attempts' => 'integer',
            'sent_at' => 'datetime',
            'read_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
