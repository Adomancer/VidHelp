<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Auth\Concerns\SignsUserIn;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Socialite\Facades\Socialite;
use Throwable;

class GoogleAuthController extends Controller
{
    use SignsUserIn;

    /**
     * Get the Google consent screen URL.
     *
     * The frontend sends the browser there. Google then redirects back to the
     * frontend (GOOGLE_REDIRECT_URI), which forwards the query string to callback().
     */
    public function redirect(): JsonResponse
    {
        $url = Socialite::driver('google')
            ->stateless()
            ->redirect()
            ->getTargetUrl();

        return response()->json(['url' => $url]);
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
