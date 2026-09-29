<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A user's authenticator-app secret and hashed recovery codes.
 */
#[Table('two_factor_auth')]
#[Fillable(['user_id', 'secret_key_encrypted', 'recovery_codes_hash', 'is_enabled', 'enabled_at', 'last_used_step'])]
#[Hidden(['secret_key_encrypted', 'recovery_codes_hash'])]
class TwoFactorAuth extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'secret_key_encrypted' => 'encrypted',
            'recovery_codes_hash' => 'array',
            'is_enabled' => 'boolean',
            'enabled_at' => 'datetime',
            'last_used_step' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
