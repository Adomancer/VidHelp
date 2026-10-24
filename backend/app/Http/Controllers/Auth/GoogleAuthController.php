<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Auth\Concerns\SignsUserIn;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Throwable;

class GoogleAuthController extends Controller
{
    use SignsUserIn;

    private const STATE_CACHE_PREFIX = 'google-oauth-state:';

    /** How long the consent screen may take before its state is no longer accepted. */
    private const STATE_MINUTES = 10;

    /**
     * Get the Google consent screen URL.
     *
     * The frontend sends the browser there. Google then redirects back to the
     * frontend (GOOGLE_REDIRECT_URI), which forwards the query string to callback().
     * The `state` is checked there once, so nobody can finish a sign-in they didn't start
     * (e.g. sign a victim in to the attacker's account).
     */
    public function redirect(): JsonResponse
    {
        $state = Str::random(40);
        Cache::put(self::STATE_CACHE_PREFIX.$state, true, now()->addMinutes(self::STATE_MINUTES));

        $url = Socialite::driver('google')
            ->stateless()
            ->with(['state' => $state])
            ->redirect()
            ->getTargetUrl();

        return response()->json(['url' => $url, 'state' => $state]);
    }

    /**
     * Exchange the Google authorization code for a VidHelp token.
     *
     * Existing accounts are matched by google_id, then by verified email (and linked).
     * Unknown accounts are registered as pending hosts awaiting admin approval.
     * Admins with 2FA get a challenge for the code step instead of a token.
     */
    public function callback(Request $request): JsonResponse
    {
        if (! is_string($request->state) || ! Cache::pull(self::STATE_CACHE_PREFIX.$request->state)) {
            return response()->json(['message' => 'Link masuk ini sudah kedaluwarsa. Silakan coba lagi.'], 401);
        }

        try {
            $googleUser = Socialite::driver('google')->stateless()->user();
        } catch (Throwable $e) {
            report($e);

            return response()->json(['message' => 'Gagal masuk dengan Google. Silakan coba lagi.'], 401);
        }

        if (! ($googleUser->user['email_verified'] ?? false)) {
            return response()->json(['message' => 'Alamat email Google kamu belum terverifikasi.'], 403);
        }

        $user = User::where('google_id', $googleUser->getId())->first()
            ?? User::where('email', $googleUser->getEmail())->first();

        if (! $user) {
            $user = User::create([
                'name' => $googleUser->getName(),
                'email' => $googleUser->getEmail(),
                'email_verified_at' => now(),
                'google_id' => $googleUser->getId(),
                'avatar' => $googleUser->getAvatar(),
                'status' => 'pending',
                'signup_source' => 'self_register',
            ]);
            $user->assignRole('host');
            app(Notifier::class)->signupPending($user);

            return response()->json([
                'message' => 'Akun dibuat. Admin perlu menyetujuinya dulu sebelum kamu bisa masuk.',
                'status' => 'pending',
            ], 202);
        }

        // Anyone can sign up with someone else's email (it isn't verified). When the owner of that
        // email signs in with Google, the password chosen at sign-up stops working.
        if ($user->signup_source === 'self_register' && $user->email_verified_at === null && $user->password !== null) {
            $user->forceFill(['password' => null])->save();
            $user->tokens()->delete();
            AuditLog::record('unverified_password_removed', $user, new: ['method' => 'google'], actor: $user);
        }

        // Link Google to an account that was created by email/password or by an admin
        $user->fill([
            'google_id' => $user->google_id ?? $googleUser->getId(),
            'avatar' => $user->avatar ?? $googleUser->getAvatar(),
            'email_verified_at' => $user->email_verified_at ?? now(),
        ])->save();

        if ($reason = $user->loginBlockedReason()) {
            return response()->json(['message' => $reason, 'status' => $user->status], 403);
        }

        return $this->signIn($user, 'google', 'google-auth-token');
    }
}
