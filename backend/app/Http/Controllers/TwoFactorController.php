<?php

namespace App\Http\Controllers;

use App\Services\TwoFactorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * My two-factor authentication (admins only): set up, recovery codes, turn off.
 */
class TwoFactorController extends Controller
{
    public function __construct(private TwoFactorService $twoFactor) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json($this->twoFactor->status($request->user()));
    }

    /** Step 1: a new secret for the QR code. */
    public function setup(Request $request): JsonResponse
    {
        return response()->json($this->twoFactor->beginSetup($request->user()));
    }

    /** Step 2: the first code from the app turns 2FA on. */
    public function confirm(Request $request): JsonResponse
    {
        $request->validate(['code' => 'required|string']);
        $user = $request->user();

        $codes = $this->twoFactor->confirm($user, $request->code);

        return response()->json([
            'message' => 'Two-factor authentication is on.',
            'recovery_codes' => $codes,
            'user' => $user->fresh()->forSession(),
        ]);
    }

    public function regenerateRecoveryCodes(Request $request): JsonResponse
    {
        $request->validate(['code' => 'required|string']);

        return response()->json([
            'message' => 'New recovery codes created. The old ones no longer work.',
            'recovery_codes' => $this->twoFactor->regenerateRecoveryCodes($request->user(), $request->code),
        ]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $request->validate(['code' => 'required|string']);
        $this->twoFactor->disable($request->user(), $request->code);

        return response()->json(['message' => 'Two-factor authentication is off.']);
    }
}
