<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserIsActive
{
    /**
     * Reject tokens belonging to users who are no longer active
     * (e.g. set back to pending or deactivated after the token was issued).
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && ($reason = $user->loginBlockedReason())) {
            return response()->json(['message' => $reason, 'status' => $user->status], 403);
        }

        return $next($request);
    }
}
