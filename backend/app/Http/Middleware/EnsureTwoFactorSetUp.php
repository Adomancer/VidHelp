<?php

namespace App\Http\Middleware;

use App\Services\TwoFactorService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureTwoFactorSetUp
{
    public function __construct(private TwoFactorService $twoFactor) {}

    /**
     * Admins who haven't set up 2FA yet (while it's required) can only reach
     * the 2FA setup routes, /auth/me and logout.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $this->twoFactor->needsSetup($user)) {
            return response()->json([
                'message' => 'Set up two-factor authentication to continue.',
                'code' => 'two_factor_setup_required',
            ], 403);
        }

        return $next($request);
    }
}
