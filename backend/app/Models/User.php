<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

#[Fillable([
    'name', 'email', 'email_verified_at', 'password', 'google_id', 'avatar',
    'status', 'signup_source', 'approved_by', 'approved_at', 'last_login_at',
])]
#[Hidden(['password', 'remember_token', 'google_id'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, HasApiTokens, HasRoles, HasUuids, SoftDeletes;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'approved_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'two_factor_enabled' => 'boolean',
        ];
    }

    /**
     * The admin who approved this account.
     */
    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    /**
     * Why this user may not log in, or null if they can.
     */
    public function loginBlockedReason(): ?string
    {
        return match ($this->status) {
            'active' => null,
            'pending' => 'Your account is waiting for admin approval.',
            default => 'Your account has been deactivated.',
        };
    }

    /**
     * Record the login and issue a new API token.
     */
    public function issueToken(string $name = 'auth-token'): string
    {
        $this->forceFill(['last_login_at' => now()])->save();

        return $this->createToken($name)->plainTextToken;
    }
}
