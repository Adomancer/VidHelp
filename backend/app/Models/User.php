<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Models\Concerns\Auditable;
use App\Services\TwoFactorService;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Appends;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

#[Fillable([
    'name', 'email', 'email_verified_at', 'password', 'google_id', 'avatar',
    'status', 'signup_source', 'approved_by', 'approved_at', 'last_login_at',
])]
#[Hidden(['password', 'remember_token', 'google_id'])]
#[Appends(['has_password', 'avatar_url'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use Auditable, HasApiTokens, HasFactory, HasRoles, HasUuids, Notifiable, SoftDeletes;

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
            'erased_at' => 'datetime',
            'password' => 'hashed',
            'two_factor_enabled' => 'boolean',
        ];
    }

    /**
     * Whether the user can log in with a password (Google-only accounts cannot).
     */
    protected function hasPassword(): Attribute
    {
        return Attribute::get(fn () => $this->password !== null);
    }

    /**
     * Displayable photo URL: the Google photo, or an uploaded file on the public disk.
     */
    protected function avatarUrl(): Attribute
    {
        return Attribute::get(fn () => match (true) {
            $this->avatar === null => null,
            str_starts_with($this->avatar, 'http') => $this->avatar,
            default => Storage::disk('public')->url($this->avatar),
        });
    }

    /**
     * Admins who must still set up 2FA before using the app (sent with login and /auth/me).
     */
    protected function twoFactorSetupRequired(): Attribute
    {
        return Attribute::get(fn () => app(TwoFactorService::class)->needsSetup($this));
    }

    /** The user as the frontend keeps it after sign-in. */
    public function forSession(): static
    {
        return $this->load('roles')->append('two_factor_setup_required');
    }

    /** Changes on every sign-in; not worth an audit row. */
    public function auditExcept(): array
    {
        return ['last_login_at'];
    }

    public function twoFactorAuth(): HasOne
    {
        return $this->hasOne(TwoFactorAuth::class);
    }

    public function discordLink(): HasOne
    {
        return $this->hasOne(DiscordLink::class);
    }

    public function hostProfile(): HasOne
    {
        return $this->hasOne(HostProfile::class);
    }

    /**
     * Create the host profile for an active host who doesn't have one yet
     * (join date = today, rate category from tenure).
     */
    public function ensureHostProfile(): void
    {
        if ($this->status !== 'active' || ! $this->hasRole('host') || $this->hostProfile()->exists()) {
            return;
        }

        $profile = $this->hostProfile()->make(['join_date' => today()]);
        $profile->syncRateCategory();
        $profile->save();
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
            'pending' => 'Akunmu sedang menunggu persetujuan admin.',
            default => 'Akunmu sudah dinonaktifkan.',
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
