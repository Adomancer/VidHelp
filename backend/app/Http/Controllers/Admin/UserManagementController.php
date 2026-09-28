<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Spatie\Permission\Models\Role;

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
            $user->syncRoles([$validated['role']]);
            unset($validated['role']);
        }

        $user->update($validated);

        return response()->json([
            'user' => $user->fresh()->load('roles'),
            'message' => 'User updated successfully',
        ]);
    }

    /**
     * Deactivate a user.
     */
    public function deactivate(User $user): JsonResponse
    {
        $user->update(['status' => 'inactive']);
        $user->tokens()->delete(); // Revoke all tokens

        return response()->json(['message' => 'User deactivated']);
    }

    /**
     * Activate a user. The first activation of a pending signup records the approval.
     */
    public function activate(Request $request, User $user): JsonResponse
    {
        $user->update([
            'status' => 'active',
            'approved_by' => $user->approved_by ?? $request->user()->id,
            'approved_at' => $user->approved_at ?? now(),
        ]);

        return response()->json(['message' => 'User activated']);
    }
}
