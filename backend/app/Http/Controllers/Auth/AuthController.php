<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Auth\Concerns\SignsUserIn;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\Notifier;
use App\Services\TwoFactorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    use SignsUserIn;

    /** A bcrypt hash (cost 12, like real passwords) that no password matches. */
    private const DUMMY_HASH = '$2y$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    /**
     * Register a new user.
     */
    public function register(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password']),
            'status' => 'pending',
            'signup_source' => 'self_register',
        ]);

        // Default role is host; an admin must approve the account before login
        $user->assignRole('host');
        app(Notifier::class)->signupPending($user);

        return response()->json([
            'message' => 'Akun dibuat. Admin perlu menyetujuinya dulu sebelum kamu bisa masuk.',
            'status' => 'pending',
        ], 201);
    }

    /**
     * Login user and return token (or, for admins with 2FA, a challenge for the code step).
     */
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        // Tries are limited per email from one IP, and per email in total (many IPs, one account). Each
        // try counts before the password is checked, so tries sent at once can't all get through; a
        // right password resets both.
        $email = Str::lower($request->email);
        $limits = [
            "login:{$email}|{$request->ip()}" => [config('vidhelp.login.max_attempts'), config('vidhelp.login.decay_minutes')],
            "login:{$email}" => [config('vidhelp.login.account_max_attempts'), config('vidhelp.login.account_decay_minutes')],
        ];
        foreach ($limits as $key => [$maxAttempts, $decayMinutes]) {
            if (RateLimiter::increment($key, $decayMinutes * 60) > $maxAttempts) {
                throw ValidationException::withMessages([
                    'email' => ['Terlalu banyak percobaan masuk. Coba lagi dalam '.max(1, (int) ceil(RateLimiter::availableIn($key) / 60)).' menit.'],
                ]);
            }
        }

        $user = User::where('email', $request->email)->first();

        // Checked against a dummy hash when there is no password, so an unknown email takes as long to answer
        if (! Hash::check($request->password, $user?->password ?? self::DUMMY_HASH) || ! $user) {
            AuditLog::record('login_failed', $user, new: ['email' => $request->email, 'method' => 'password']);

            throw ValidationException::withMessages([
                'email' => ['Email atau kata sandi salah.'],
            ]);
        }

        foreach (array_keys($limits) as $key) {
            RateLimiter::clear($key);
        }

        if ($reason = $user->loginBlockedReason()) {
            throw ValidationException::withMessages([
                'email' => [$reason],
            ]);
        }

        return $this->signIn($user, 'password');
    }

    /**
     * Second sign-in step for admins with 2FA: a code from the authenticator app or a recovery code.
     */
    public function twoFactorChallenge(Request $request, TwoFactorService $twoFactor): JsonResponse
    {
        $request->validate([
            'challenge_token' => 'required|string',
            'code' => 'nullable|string|required_without:recovery_code',
            'recovery_code' => 'nullable|string',
        ]);

        ['user' => $user, 'method' => $method, 'token_name' => $tokenName] = $twoFactor->completeChallenge(
            $request->challenge_token,
            $request->code,
            $request->recovery_code,
        );

        return $this->issueSession($user, $method, $tokenName, twoFactor: true);
    }

    /**
     * Logout user (revoke current token).
     */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();
        AuditLog::record('logout', $request->user());

        return response()->json(['message' => 'Berhasil keluar']);
    }

    /**
     * Get current authenticated user profile.
     */
    public function me(Request $request): JsonResponse
    {
        return response()->json([
            'user' => $request->user()->forSession()->load('permissions'),
        ]);
    }
}
