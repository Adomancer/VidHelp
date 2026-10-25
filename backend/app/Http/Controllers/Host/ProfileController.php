<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\HostProfile;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Services\ProfileChangeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\PersonalAccessToken;

class ProfileController extends Controller
{
    private const SENT = 'Perubahan dikirim. Datamu berubah setelah disetujui admin.';

    public function __construct(private ProfileChangeService $changes) {}

    /**
     * Get my account plus host profile (null for users without one, e.g. admins).
     * KTP and bank numbers are only returned masked.
     */
    public function show(Request $request): JsonResponse
    {
        return response()->json($this->payload($request->user()));
    }

    /**
     * My name and, for hosts, contact numbers. For hosts it becomes a request an admin approves;
     * other users (e.g. staff) change their name straight away.
     */
    public function update(Request $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->hostProfile;

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'phone' => [$profile ? 'sometimes' : 'prohibited', 'nullable', 'digits_between:8,15'],
            'guardian_phone' => [$profile ? 'sometimes' : 'prohibited', 'nullable', 'digits_between:8,15'],
        ]);

        if ($profile) {
            $this->changes->submit($profile, Arr::only($validated, ['name', 'phone', 'guardian_phone']));

            return response()->json([...$this->payload($user->fresh()), 'message' => self::SENT]);
        }

        $user->update(Arr::only($validated, ['name']));

        return response()->json([...$this->payload($user->fresh()), 'message' => 'Profil berhasil diperbarui']);
    }

    /**
     * Upload a new profile photo (replaces a Google photo too).
     */
    public function updatePhoto(Request $request): JsonResponse
    {
        $request->validate(['photo' => 'required|image|max:2048']);

        $user = $request->user();
        $this->deleteUploadedAvatar($user);
        $user->update(['avatar' => $request->file('photo')->store('avatars', 'public')]);

        return response()->json([...$this->payload($user->fresh()), 'message' => 'Foto diperbarui']);
    }

    /**
     * Ask to save my KTP number and bank details (an admin approves). Stored encrypted;
     * only admins see the full values.
     */
    public function updateSensitive(Request $request): JsonResponse
    {
        $profile = $this->requireHostProfile($request);

        $validated = $request->validate([
            'ktp_number' => 'sometimes|nullable|digits:16',
            'bank_name' => 'sometimes|nullable|string|max:100',
            'bank_account' => 'sometimes|nullable|digits_between:5,20',
            'account_holder_name' => 'sometimes|nullable|string|max:255',
        ]);

        $this->changes->submit($profile, $validated);

        return response()->json([...$this->payload($request->user()->fresh()), 'message' => self::SENT]);
    }

    /**
     * Take back my pending change request.
     */
    public function cancelChange(Request $request, ProfileChangeRequest $change): JsonResponse
    {
        abort_unless($change->host_id === $this->requireHostProfile($request)->id, 403, 'Ini bukan permintaanmu.');

        $this->changes->cancel($change);

        return response()->json([...$this->payload($request->user()->fresh()), 'message' => 'Permintaan perubahan dibatalkan']);
    }

    /**
     * My profile, plus (for hosts) the change waiting for an admin and the last decision.
     */
    private function payload(User $user): array
    {
        $profile = $user->hostProfile;
        $latest = $profile
            ? ProfileChangeRequest::where('host_id', $profile->id)->where('status', '!=', 'cancelled')->latest()->first()
            : null;

        return [
            'user' => $user->load('roles'),
            'host_profile' => $profile?->load([
                'rateCategory',
                'sensitiveData',
                'assignments' => fn ($q) => $q->where('status', 'active')->with('brand:id,name,is_obs'),
            ])->makeVisible('guardian_phone'),
            'profile_change' => $latest ? [
                'id' => $latest->id,
                'status' => $latest->status,
                'fields' => $latest->lines(),
                'created_at' => $latest->created_at,
                'reviewed_at' => $latest->reviewed_at,
                'review_note' => $latest->review_note,
            ] : null,
        ];
    }

    private function requireHostProfile(Request $request): HostProfile
    {
        return $request->user()->hostProfile
            ?? abort(404, 'Kamu tidak punya profil host.');
    }

    private function deleteUploadedAvatar(User $user): void
    {
        if ($user->avatar && ! str_starts_with($user->avatar, 'http')) {
            Storage::disk('public')->delete($user->avatar);
        }
    }

    /**
     * Change password, or set a first one for Google-only accounts.
     */
    public function changePassword(Request $request): JsonResponse
    {
        $user = $request->user();

        $request->validate([
            'current_password' => $user->has_password ? 'required' : 'nullable',
            'password' => 'required|string|min:8|confirmed',
        ]);

        if ($user->has_password && ! Hash::check($request->current_password, $user->password)) {
            return response()->json([
                'message' => 'Kata sandi saat ini salah',
            ], 422);
        }

        $user->update([
            'password' => Hash::make($request->password),
        ]);

        // Changing the password is how someone locks out whoever else has their account: sign out everywhere else
        $current = $user->currentAccessToken();
        $user->tokens()
            ->when($current instanceof PersonalAccessToken, fn ($q) => $q->whereKeyNot($current->getKey()))
            ->delete();
        AuditLog::record('password_changed', $user, actor: $user);

        // A linked Discord stays linked and still gets reset links: say which one, in case it isn't theirs
        $discord = $user->discordLink?->discord_username;

        return response()->json(['message' => $discord
            ? "Kata sandi berhasil diganti. Discord {$discord} masih terhubung dan menerima link atur ulang kata sandi. Putuskan kalau itu bukan Discord-mu."
            : 'Kata sandi berhasil diganti']);
    }
}
