<?php

namespace App\Services;

use App\Models\HostProfile;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Hosts' personal data (name, phones, KTP number, bank) only changes once an admin
 * approves it. A host has at most one pending request; sending more changes adds to it.
 */
class ProfileChangeService
{
    public function __construct(private Notifier $notifier) {}

    /** The saved values of every field a host can ask to change. */
    public function current(HostProfile $host): array
    {
        $host->loadMissing(['user', 'sensitiveData']);
        $sensitive = $host->sensitiveData;

        return [
            'name' => $host->user->name,
            'phone' => $host->phone,
            'guardian_phone' => $host->guardian_phone,
            'ktp_number' => $sensitive?->ktp_number,
            'bank_name' => $sensitive?->bank_name,
            'bank_account' => $sensitive?->bank_account,
            'account_holder_name' => $sensitive?->account_holder_name,
        ];
    }

    public function pending(HostProfile $host): ?ProfileChangeRequest
    {
        return ProfileChangeRequest::where('host_id', $host->id)->where('status', 'pending')->latest()->first();
    }

    /**
     * Ask for new values. Values equal to what is saved are left out; a pending request is
     * updated rather than a second one opened.
     *
     * @param  array<string, ?string>  $values
     */
    public function submit(HostProfile $host, array $values): ProfileChangeRequest
    {
        $current = $this->current($host);
        $pending = $this->pending($host);
        $changes = $pending?->new_values ?? [];

        foreach (array_intersect_key($values, ProfileChangeRequest::FIELDS) as $field => $value) {
            $value = is_string($value) ? trim($value) : $value;
            $value = $value === '' ? null : $value;

            if (($current[$field] ?? null) === $value) {
                unset($changes[$field]); // back to what is saved: nothing to ask for
            } else {
                $changes[$field] = $value;
            }
        }

        if ($changes === []) {
            throw ValidationException::withMessages(['changes' => ['Tidak ada perubahan dibanding data yang tersimpan.']]);
        }

        $request = $pending ?? new ProfileChangeRequest(['host_id' => $host->id, 'status' => 'pending']);
        $request->new_values = $changes;
        $request->save();

        if (! $pending) {
            $what = collect($request->lines())->pluck('label')->implode(', ');
            $this->notifier->toUsers(
                $this->notifier->admins(),
                'profile_change_requested',
                "Perubahan data: {$host->user->name}",
                "{$what}. Setujui atau tolak di halaman Host.",
                '/admin/hosts?changes=pending',
            );
        }

        return $request;
    }

    /** Put the new values on the profile. */
    public function approve(ProfileChangeRequest $request, User $by): void
    {
        $this->ensurePending($request);
        $host = $request->host()->with(['user', 'sensitiveData'])->firstOrFail();
        $changes = $request->new_values ?? [];

        DB::transaction(function () use ($request, $host, $changes, $by) {
            if (array_key_exists('name', $changes) && $changes['name'] !== null) {
                $host->user->update(['name' => $changes['name']]);
            }

            $host->update(array_intersect_key($changes, array_flip(['phone', 'guardian_phone'])));

            $sensitive = array_intersect_key($changes, array_flip(['ktp_number', 'bank_name', 'bank_account', 'account_holder_name']));
            if ($sensitive !== []) {
                $host->sensitiveData()->updateOrCreate([], $sensitive);
            }

            $request->update(['status' => 'approved', 'reviewed_by' => $by->id, 'reviewed_at' => now()]);
        });

        $this->notifier->toUsers($host->user, 'profile_change_approved', 'Perubahan data disetujui', 'Data pribadimu sudah diperbarui.', '/host/profile', dm: true);
    }

    public function reject(ProfileChangeRequest $request, User $by, string $note): void
    {
        $this->ensurePending($request);
        $request->update(['status' => 'rejected', 'reviewed_by' => $by->id, 'reviewed_at' => now(), 'review_note' => $note]);

        $this->notifier->toUsers($request->host->user, 'profile_change_rejected', 'Perubahan data ditolak', $note, '/host/profile', dm: true);
    }

    /** The host takes their request back. */
    public function cancel(ProfileChangeRequest $request): void
    {
        $this->ensurePending($request);
        $request->update(['status' => 'cancelled']);
    }

    private function ensurePending(ProfileChangeRequest $request): void
    {
        if ($request->status !== 'pending') {
            throw ValidationException::withMessages(['request' => ['Permintaan ini sudah diputuskan atau dibatalkan.']]);
        }
    }
}
