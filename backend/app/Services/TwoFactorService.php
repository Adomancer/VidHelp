<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\TwoFactorAuth;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Authenticator-app two-factor sign-in for the accounts that handle sensitive data or money:
 * admins and finance. When vidhelp.two_factor.required_for_admins is on, such an account
 * without it is limited to setting it up.
 */
class TwoFactorService
{
    /** Roles that use 2FA: admins (KTP, bank, settings) and finance (payments). */
    public const ROLES = ['admin', 'finance'];

    /** 2FA is for admins and finance only. */
    public function appliesTo(User $user): bool
    {
        return $user->hasAnyRole(self::ROLES);
    }

    public function isRequired(User $user): bool
    {
        return $this->appliesTo($user) && config('vidhelp.two_factor.required_for_admins');
    }

    /** Signed-in admin or finance user who still has to set 2FA up before doing anything else. */
    public function needsSetup(User $user): bool
    {
        return $this->isRequired($user) && ! $user->two_factor_enabled;
    }

    /** Password/Google sign-in must be followed by a code. */
    public function needsChallenge(User $user): bool
    {
        return $this->appliesTo($user) && $user->two_factor_enabled;
    }

    /**
     * @return array{enabled: bool, required: bool, available: bool, enabled_at: ?string, recovery_codes_left: int}
     */
    public function status(User $user): array
    {
        $record = $this->record($user);
        $enabled = (bool) $record?->is_enabled;

        return [
            'available' => $this->appliesTo($user),
            'required' => $this->isRequired($user),
            'enabled' => $enabled,
            'enabled_at' => $enabled ? $record->enabled_at?->toIso8601String() : null,
            'recovery_codes_left' => $enabled ? count($record->recovery_codes_hash ?? []) : 0,
        ];
    }

    /**
     * Start (or restart) setup: a fresh secret that becomes active once confirm() gets a valid code.
     *
     * @return array{secret: string, otpauth_url: string}
     */
    public function beginSetup(User $user): array
    {
        if ($user->two_factor_enabled) {
            throw ValidationException::withMessages(['code' => ['Verifikasi dua langkah sudah aktif.']]);
        }

        $secret = Totp::generateSecret();
        TwoFactorAuth::updateOrCreate(['user_id' => $user->id], [
            'secret_key_encrypted' => $secret,
            'recovery_codes_hash' => null,
            'is_enabled' => false,
            'enabled_at' => null,
            'last_used_step' => null,
        ]);

        return [
            'secret' => $secret,
            'otpauth_url' => Totp::otpauthUrl($secret, $user->email, config('vidhelp.two_factor.issuer')),
        ];
    }

    /**
     * Turn 2FA on with the first code from the app. Returns the recovery codes (shown once).
     *
     * @return list<string>
     */
    public function confirm(User $user, string $code): array
    {
        $record = $this->record($user);
        if (! $record || $record->is_enabled) {
            throw ValidationException::withMessages(['code' => ['Mulai pengaturan dari awal lagi.']]);
        }

        $step = Totp::verify($record->secret_key_encrypted, $code);
        if ($step === null) {
            throw ValidationException::withMessages(['code' => ['Kode itu salah. Cek jam di HP kamu dan coba kode terbaru.']]);
        }

        $codes = $this->newRecoveryCodes();
        DB::transaction(function () use ($user, $record, $step, $codes) {
            $record->update([
                'is_enabled' => true,
                'enabled_at' => now(),
                'last_used_step' => $step,
                'recovery_codes_hash' => $this->hashRecoveryCodes($codes),
            ]);
            $user->forceFill(['two_factor_enabled' => true])->save();
        });

        AuditLog::record('two_factor_enabled', $user);

        return $codes;
    }

    /**
     * Check an app code or a recovery code for a user who has 2FA on. A recovery code
     * works once; an app code can't be replayed.
     */
    public function verify(User $user, ?string $code, ?string $recoveryCode): bool
    {
        $record = $this->record($user);
        if (! $record?->is_enabled) {
            return false;
        }

        if (filled($code)) {
            $step = Totp::verify($record->secret_key_encrypted, $code, $record->last_used_step);
            if ($step === null) {
                return false;
            }
            $record->update(['last_used_step' => $step]);

            return true;
        }

        if (filled($recoveryCode)) {
            $typed = self::normalizeRecoveryCode($recoveryCode);
            $hashes = $record->recovery_codes_hash ?? [];
            foreach ($hashes as $index => $hash) {
                if (Hash::check($typed, $hash)) {
                    unset($hashes[$index]);
                    $record->update(['recovery_codes_hash' => array_values($hashes)]);
                    AuditLog::record('recovery_code_used', $user, new: ['codes_left' => count($hashes)], actor: $user);

                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Replace all recovery codes (needs a current app code).
     *
     * @return list<string>
     */
    public function regenerateRecoveryCodes(User $user, string $code): array
    {
        $this->requireCode($user, $code);

        $codes = $this->newRecoveryCodes();
        $this->record($user)->update(['recovery_codes_hash' => $this->hashRecoveryCodes($codes)]);
        AuditLog::record('recovery_codes_regenerated', $user);

        return $codes;
    }

    /** Turn 2FA off yourself (only when it isn't required). */
    public function disable(User $user, string $code): void
    {
        if ($this->isRequired($user)) {
            throw ValidationException::withMessages(['code' => ['Verifikasi dua langkah wajib untuk akunmu dan tidak bisa dimatikan.']]);
        }

        $this->requireCode($user, $code);
        $this->turnOff($user);
        AuditLog::record('two_factor_disabled', $user);
    }

    /**
     * Another admin resets a user's 2FA (lost phone and recovery codes). The user is
     * signed out everywhere and sets 2FA up again at the next sign-in.
     */
    public function reset(User $user, User $by): void
    {
        if ($user->is($by)) {
            throw ValidationException::withMessages(['user' => ['Kamu tidak bisa mereset verifikasi dua langkah milikmu sendiri.']]);
        }

        $this->turnOff($user);
        $user->tokens()->delete();
        AuditLog::record('two_factor_reset', $user, actor: $by);
    }

    /**
     * After the password/Google step: remember who is signing in for a few minutes
     * and hand the frontend a one-time token for the code step.
     */
    public function startChallenge(User $user, string $method, string $tokenName): string
    {
        $challenge = Str::random(64);
        Cache::put($this->challengeKey($challenge), [
            'user_id' => $user->id,
            'method' => $method,
            'token_name' => $tokenName,
            'attempts' => 0,
        ], now()->addMinutes(config('vidhelp.two_factor.challenge_minutes')));

        return $challenge;
    }

    /**
     * The code step. Returns the user and how they signed in; the challenge is used up
     * on success or after too many wrong codes.
     *
     * @return array{user: User, method: string, token_name: string}
     */
    public function completeChallenge(string $challenge, ?string $code, ?string $recoveryCode): array
    {
        $key = $this->challengeKey($challenge);
        $pending = Cache::get($key);
        $user = $pending ? User::find($pending['user_id']) : null;

        if (! $user) {
            throw ValidationException::withMessages(['challenge_token' => ['Sesi masuk ini sudah kedaluwarsa. Silakan masuk lagi.']]);
        }

        if ($reason = $user->loginBlockedReason()) {
            Cache::forget($key);
            throw ValidationException::withMessages(['challenge_token' => [$reason]]);
        }

        if (! $this->verify($user, $code, $recoveryCode)) {
            $attempts = $pending['attempts'] + 1;
            AuditLog::record('two_factor_failed', $user, new: ['method' => $pending['method'], 'attempt' => $attempts], actor: $user);

            if ($attempts >= config('vidhelp.two_factor.challenge_attempts')) {
                Cache::forget($key);
                throw ValidationException::withMessages(['challenge_token' => ['Terlalu banyak kode salah. Silakan masuk lagi.']]);
            }

            Cache::put($key, ['attempts' => $attempts] + $pending, now()->addMinutes(config('vidhelp.two_factor.challenge_minutes')));
            throw ValidationException::withMessages([
                filled($code) ? 'code' : 'recovery_code' => [filled($code) ? 'Kode itu salah.' : 'Kode pemulihan itu salah atau sudah pernah dipakai.'],
            ]);
        }

        Cache::forget($key);

        return ['user' => $user, 'method' => $pending['method'], 'token_name' => $pending['token_name']];
    }

    private function requireCode(User $user, string $code): void
    {
        if (! $this->verify($user, $code, null)) {
            throw ValidationException::withMessages(['code' => ['Kode itu salah.']]);
        }
    }

    private function turnOff(User $user): void
    {
        DB::transaction(function () use ($user) {
            TwoFactorAuth::where('user_id', $user->id)->delete();
            $user->forceFill(['two_factor_enabled' => false])->save();
        });
    }

    private function record(User $user): ?TwoFactorAuth
    {
        return TwoFactorAuth::where('user_id', $user->id)->first();
    }

    /** @return list<string> e.g. "K7QD-M2XP" (no 0/O or 1/I so they're easy to copy from paper) */
    private function newRecoveryCodes(): array
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $part = fn () => implode('', array_map(fn () => $alphabet[random_int(0, strlen($alphabet) - 1)], range(1, 4)));

        return collect(range(1, config('vidhelp.two_factor.recovery_codes')))
            ->map(fn () => $part().'-'.$part())
            ->all();
    }

    /** @param  list<string>  $codes */
    private function hashRecoveryCodes(array $codes): array
    {
        return array_map(fn ($code) => Hash::make(self::normalizeRecoveryCode($code)), $codes);
    }

    private static function normalizeRecoveryCode(string $code): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $code));
    }

    private function challengeKey(string $challenge): string
    {
        return 'two-factor-challenge:'.hash('sha256', $challenge);
    }
}
