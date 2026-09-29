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
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    use SignsUserIn;

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
            'message' => 'Account created. An admin needs to approve it before you can sign in.',
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

        $user = User::where('email', $request->email)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            AuditLog::record('login_failed', $user, new: ['email' => $request->email, 'method' => 'password']);

            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
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

        return response()->json(['message' => 'Logged out successfully']);
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
