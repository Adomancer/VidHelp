<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;

class ProfileController extends Controller
{
    /**
     * Get my account plus host profile (null for users without one, e.g. admins).
     * KTP and bank numbers are only returned masked.
     */
    public function show(Request $request): JsonResponse
    {
        return response()->json($this->payload($request->user()));
    }

    /**
     * Update my name and, for hosts, contact numbers.
     */
    public function update(Request $request): JsonResponse
    {
        $user = $request->user();
        $profile = $user->hostProfile;

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'phone' => [$profile ? 'sometimes' : 'prohibited', 'nullable', 'regex:/^\+?[0-9 \-]{8,20}$/'],
            'guardian_phone' => [$profile ? 'sometimes' : 'prohibited', 'nullable', 'regex:/^\+?[0-9 \-]{8,20}$/'],
        ]);

        $user->update(Arr::only($validated, ['name']));
        $profile?->update(Arr::only($validated, ['phone', 'guardian_phone']));

        return response()->json([...$this->payload($user->fresh()), 'message' => 'Profile updated successfully']);
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

        return response()->json([...$this->payload($user->fresh()), 'message' => 'Photo updated']);
    }

    /**
     * Save my KTP number and bank details. Stored encrypted; only admins see the full values.
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

        $profile->sensitiveData()->updateOrCreate([], $validated);

        return response()->json([...$this->payload($request->user()->fresh()), 'message' => 'Data saved']);
    }

    /**
     * Upload a photo of my KTP to private storage (admins can view it).
     */
    public function uploadKtpImage(Request $request): JsonResponse
    {
        $profile = $this->requireHostProfile($request);
        $request->validate(['ktp_image' => 'required|image|max:4096']);

        $sensitive = $profile->sensitiveData()->firstOrNew();
        if ($sensitive->ktp_image_path) {
            Storage::disk('local')->delete($sensitive->ktp_image_path);
        }
        $sensitive->ktp_image_path = $request->file('ktp_image')->store('ktp', 'local');
        $sensitive->save();

        return response()->json([...$this->payload($request->user()->fresh()), 'message' => 'KTP photo uploaded']);
    }

    private function payload(User $user): array
    {
        return [
            'user' => $user->load('roles'),
            'host_profile' => $user->hostProfile?->load([
                'rateCategory',
                'sensitiveData',
                'assignments' => fn ($q) => $q->where('status', 'active')->with('brand:id,name,is_obs'),
            ]),
        ];
    }

    private function requireHostProfile(Request $request): HostProfile
    {
        return $request->user()->hostProfile
            ?? abort(404, 'You do not have a host profile.');
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
                'message' => 'Current password is incorrect',
            ], 422);
        }

        $user->update([
            'password' => Hash::make($request->password),
        ]);

        return response()->json(['message' => 'Password changed successfully']);
    }
}
