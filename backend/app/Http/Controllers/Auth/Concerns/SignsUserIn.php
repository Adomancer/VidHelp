<?php

namespace App\Http\Controllers\Auth\Concerns;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\TwoFactorService;
use Illuminate\Http\JsonResponse;

trait SignsUserIn
{
    /**
     * Finish a password/Google sign-in: admins with 2FA get a code step first,
     * everyone else gets their token right away.
     */
    protected function signIn(User $user, string $method, string $tokenName = 'auth-token'): JsonResponse
    {
        $twoFactor = app(TwoFactorService::class);

        if ($twoFactor->needsChallenge($user)) {
            return response()->json([
                'two_factor' => true,
                'challenge_token' => $twoFactor->startChallenge($user, $method, $tokenName),
                'message' => 'Masukkan kode 6 digit dari aplikasi authenticator kamu.',
            ]);
        }

        return $this->issueSession($user, $method, $tokenName);
    }

    protected function issueSession(User $user, string $method, string $tokenName, bool $twoFactor = false): JsonResponse
    {
        $token = $user->issueToken($tokenName);
        AuditLog::record('login', $user, new: ['method' => $method, 'two_factor' => $twoFactor], actor: $user);

        return response()->json([
            'user' => $user->forSession(),
            'token' => $token,
        ]);
    }
}
