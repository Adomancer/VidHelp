<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\AccountService;
use App\Services\Notice;
use App\Services\Notifier;
use App\Services\TwoFactorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserManagementController extends Controller
{
    public const ROLES = 'host,operator,finance,admin';

    public function __construct(private AccountService $accounts) {}

    /**
     * List all users with their roles.
     */
    public function index(Request $request): JsonResponse
    {
        // An unknown role would make Spatie throw (500) instead of answering 422
        $request->validate([
            'role' => 'nullable|in:'.self::ROLES,
            'status' => 'nullable|in:pending,active,inactive,archived',
            'search' => 'nullable|string|max:100',
        ]);

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
     * Create an account (e.g. a host who doesn't sign up themselves). Active straight away.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users',
            'password' => 'required|string|min:8',
            'role' => 'required|in:'.self::ROLES,
        ]);

        $user = $this->accounts->create($validated, $request->user());

        return response()->json([
            'user' => $user->load('roles'),
            'message' => "Akun dibuat. {$user->name} sudah bisa masuk.",
        ], 201);
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
     * Update user details and role. Status changes go through activate/deactivate/archive.
     */
    public function update(Request $request, User $user): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => 'sometimes|email|unique:users,email,'.$user->id,
            'role' => 'sometimes|in:'.self::ROLES,
        ]);

        if (isset($validated['role'])) {
            $before = $user->getRoleNames()->all();
            if ($before !== [$validated['role']]) {
                $this->accounts->ensureRoleCanChange($user, $request->user());
                $user->syncRoles([$validated['role']]);
                AuditLog::record('role_change', $user, old: ['roles' => $before], new: ['roles' => [$validated['role']]]);
            }
            unset($validated['role']);
        }

        $user->update($validated);
        $user->ensureHostProfile();

        return response()->json([
            'user' => $user->fresh()->load('roles'),
            'message' => 'Pengguna berhasil diperbarui',
        ]);
    }

    /**
     * Deactivate a user for now (e.g. leave): signed out, can't sign in, schedule stays.
     */
    public function deactivate(Request $request, User $user): JsonResponse
    {
        $this->accounts->setStatus($user, 'inactive', $request->user());

        return response()->json(['message' => 'Pengguna dinonaktifkan']);
    }

    /**
     * Archive a user who left (the "delete" button): signed out and taken off the schedule.
     */
    public function archive(Request $request, User $user): JsonResponse
    {
        $this->accounts->setStatus($user, 'archived', $request->user());

        return response()->json(['message' => "{$user->name} diarsipkan dan dikeluarkan dari jadwal mulai hari ini."]);
    }

    /**
     * Delete an archived user permanently (anonymized): only when banned from a brand
     * or at the host's own request.
     */
    public function erase(Request $request, User $user): JsonResponse
    {
        $validated = $request->validate([
            'reason' => 'required|in:banned,host_request',
            'note' => 'nullable|string|max:500',
        ]);

        $this->accounts->erase($user, $validated['reason'], $validated['note'] ?? null, $request->user());

        return response()->json(['message' => 'Data pribadi dihapus. Riwayat kerja dan gaji tetap ada tanpa nama.']);
    }

    /**
     * Activate a user. The first activation of a pending signup records the approval.
     */
    public function activate(Request $request, User $user, Notifier $notifier): JsonResponse
    {
        $firstApproval = $user->approved_at === null;

        $this->accounts->setStatus($user, 'active', $request->user());
        $user->update([
            'approved_by' => $user->approved_by ?? $request->user()->id,
            'approved_at' => $user->approved_at ?? now(),
        ]);

        if ($firstApproval) {
            AuditLog::record('approve', $user);
            $notifier->toUsers($user, Notice::make('account_approved', 'Akunmu sudah disetujui')
                ->body('Selamat datang di VidHelp! Kamu sudah bisa masuk.')
                ->field('Disetujui oleh', $request->user()->name)
                ->link('/host/dashboard', 'Mulai'), dm: true);
        }

        return response()->json(['message' => 'Pengguna diaktifkan']);
    }

    /**
     * Clear an admin's 2FA (lost phone and recovery codes); they set it up again at the next sign-in.
     */
    public function resetTwoFactor(Request $request, User $user, TwoFactorService $twoFactor): JsonResponse
    {
        $twoFactor->reset($user, $request->user());

        return response()->json(['message' => "Verifikasi dua langkah {$user->name} sudah direset. Dia sudah dikeluarkan dan akan mengaturnya lagi saat masuk berikutnya."]);
    }
}
