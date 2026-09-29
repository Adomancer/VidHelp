<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\Notifier;
use App\Services\TwoFactorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserManagementController extends Controller
{
    /**
     * List all users with their roles.
     */
    public function index(Request $request): JsonResponse
    {
        $users = User::with('roles')
            ->when($request->role, fn ($q, $role) => $q->role($role))
            ->when($request->status, fn ($q, $status) => $q->where('status', $status))
            ->when($request->search, fn ($q, $search) => $q->where(fn ($q) => $q
                ->where('name', 'like', "%{$search}%")
                ->orWhere('email', 'like', "%{$search}%")))
            ->orderBy('created_at', 'desc')
            ->paginate(20);

        return response()->json($users);
    }

    /**
     * Show a single user.
     */
    public function show(User $user): JsonResponse
    {
        return response()->json([
            'user' => $user->load('roles', 'permissions'),
        ]);
    }

    /**
     * Update user details and role.
     */
    public function update(Request $request, User $user): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => 'sometimes|email|unique:users,email,' . $user->id,
            'status' => 'sometimes|in:pending,active,inactive,archived',
            'role' => 'sometimes|string|exists:roles,name',
        ]);

        if (isset($validated['role'])) {
            $before = $user->getRoleNames()->all();
            $user->syncRoles([$validated['role']]);
            if ($before !== [$validated['role']]) {
                AuditLog::record('role_change', $user, old: ['roles' => $before], new: ['roles' => [$validated['role']]]);
            }
            unset($validated['role']);
        }

        $user->update($validated);
        $user->ensureHostProfile();

        return response()->json([
            'user' => $user->fresh()->load('roles'),
            'message' => 'User updated successfully',
        ]);
    }

    /**
     * Deactivate a user.
     */
    public function deactivate(Request $request, User $user): JsonResponse
    {
        if ($user->is($request->user())) {
            return response()->json(['message' => 'You cannot deactivate your own account.'], 422);
        }

        $user->update(['status' => 'inactive']);
        $user->tokens()->delete(); // Revoke all tokens

        return response()->json(['message' => 'User deactivated']);
    }

    /**
     * Activate a user. The first activation of a pending signup records the approval.
     */
    public function activate(Request $request, User $user, Notifier $notifier): JsonResponse
    {
        $firstApproval = $user->approved_at === null;

        $user->update([
            'status' => 'active',
            'approved_by' => $user->approved_by ?? $request->user()->id,
            'approved_at' => $user->approved_at ?? now(),
        ]);
        $user->ensureHostProfile();

        if ($firstApproval) {
            AuditLog::record('approve', $user);
            $notifier->toUsers($user, 'account_approved', 'Your account is approved', 'Welcome to VidHelp! You can sign in now.', '/host/live', dm: true);
        }

        return response()->json(['message' => 'User activated']);
    }

    /**
     * Clear an admin's 2FA (lost phone and recovery codes); they set it up again at the next sign-in.
     */
    public function resetTwoFactor(Request $request, User $user, TwoFactorService $twoFactor): JsonResponse
    {
        $twoFactor->reset($user, $request->user());

        return response()->json(['message' => "Two-factor authentication was reset for {$user->name}. They were signed out and will set it up again at the next sign-in."]);
    }
}
