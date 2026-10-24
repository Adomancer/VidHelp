<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

class PasswordResetController extends Controller
{
    /**
     * Send a reset link pointing at the frontend /reset-password page by email and, when the
     * user linked Discord, as a DM too (the way most people get it while the agency has no
     * verified mail domain).
     *
     * Always answers the same way so the endpoint can't be used to discover registered emails.
     */
    public function sendLink(Request $request, Notifier $notifier): JsonResponse
    {
        $request->validate(['email' => 'required|email']);

        Password::sendResetLink($request->only('email'), function (User $user, string $token) use ($notifier) {
            $notifier->passwordResetDm($user, $user->passwordResetPath($token));

            try {
                $user->sendPasswordResetNotification($token);
            } catch (Throwable $e) {
                report($e); // The DM may still reach them, and the answer stays the same
            }
        });

        return response()->json([
            'message' => 'Kalau email itu terdaftar, kami sudah mengirim link untuk mengatur ulang kata sandi ke email itu, dan ke DM Discord kalau akunnya terhubung.',
        ]);
    }

    /**
     * Set a new password using the emailed token. Also works for Google-only
     * accounts that never had a password. Signs the user out everywhere.
     */
    public function reset(Request $request): JsonResponse
    {
        $request->validate([
            'token' => 'required|string',
            'email' => 'required|email',
            'password' => 'required|string|min:8|confirmed',
        ]);

        $status = Password::reset(
            $request->only('email', 'password', 'password_confirmation', 'token'),
            function (User $user, string $password) {
                $user->forceFill([
                    'password' => $password,
                    'remember_token' => Str::random(60),
                ])->save();

                $user->tokens()->delete();
                AuditLog::record('password_reset', $user, actor: $user);
            }
        );

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages(['email' => [__($status)]]);
        }

        return response()->json(['message' => 'Kata sandimu sudah diatur ulang. Sekarang kamu bisa masuk.']);
    }
}
