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
        // Locked so an admin approving the pending request meanwhile can't miss these values
        [$request, $pending] = DB::transaction(function () use ($host, $values) {
            $pending = ProfileChangeRequest::where('host_id', $host->id)->where('status', 'pending')->latest()->lockForUpdate()->first();

            return [$this->saveValues($host, $pending, $values), $pending];
        });

        if (! $pending) {
            // Only which data changes, never the values (KTP, bank account)
            $what = collect($request->lines())->pluck('label')->implode(', ');
            $notice = Notice::make('profile_change_requested', "Perubahan data: {$host->user->name}")
                ->body("{$what}. Setujui atau tolak di halaman Host.")
                ->field('Host', $host->user->name)
                ->field('Data yang diubah', $what, inline: false)
                ->about($host->user)
                ->link('/admin/hosts?changes=pending', 'Tinjau perubahan');

            $this->notifier->toUsers($this->notifier->admins(), $notice, dm: true);
            $this->notifier->toChannel('admin', $notice);
        }

        return $request;
    }

    /**
     * Merge `$values` into the pending request (or a new one) and save it.
     *
     * @param  array<string, ?string>  $values
     */
    private function saveValues(HostProfile $host, ?ProfileChangeRequest $pending, array $values): ProfileChangeRequest
    {
        $current = $this->current($host);
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

        return $request;
    }

    /**
     * Put the new values on the profile, if they are still the `$version` the admin reviewed
     * (see ProfileChangeRequest::version()).
     */
    public function approve(ProfileChangeRequest $request, User $by, string $version): void
    {
        $host = $request->host()->with(['user', 'sensitiveData'])->firstOrFail();

        $request = DB::transaction(function () use ($request, $host, $by, $version) {
            $request = $this->lockPending($request);

            if (! hash_equals($request->version(), $version)) {
                throw ValidationException::withMessages(['version' => ['Host mengubah permintaannya setelah kamu membukanya. Periksa data terbaru lalu setujui lagi.']]);
            }

            $changes = $request->new_values ?? [];
            if (array_key_exists('name', $changes) && $changes['name'] !== null) {
                $host->user->update(['name' => $changes['name']]);
            }

            $host->update(array_intersect_key($changes, array_flip(['phone', 'guardian_phone'])));

            $sensitive = array_intersect_key($changes, array_flip(['ktp_number', 'bank_name', 'bank_account', 'account_holder_name']));
            if ($sensitive !== []) {
                $host->sensitiveData()->updateOrCreate([], $sensitive);
            }

            $request->update(['status' => 'approved', 'reviewed_by' => $by->id, 'reviewed_at' => now()]);

            return $request;
        });

        $this->notifier->toUsers($host->user, Notice::make('profile_change_approved', 'Perubahan data disetujui')
            ->body('Data pribadimu sudah diperbarui.')
            ->field('Data yang diubah', collect($request->lines())->pluck('label')->implode(', '), inline: false)
            ->field('Disetujui oleh', $by->name)
            ->link('/host/profile', 'Lihat profil'), dm: true);
    }

    public function reject(ProfileChangeRequest $request, User $by, string $note): void
    {
        $request = DB::transaction(function () use ($request, $by, $note) {
            $request = $this->lockPending($request);
            $request->update(['status' => 'rejected', 'reviewed_by' => $by->id, 'reviewed_at' => now(), 'review_note' => $note]);

            return $request;
        });

        $this->notifier->toUsers($request->host->user, Notice::make('profile_change_rejected', 'Perubahan data ditolak')
            ->body($note)
            ->field('Data yang diubah', collect($request->lines())->pluck('label')->implode(', '), inline: false)
            ->field('Ditolak oleh', $by->name)
            ->field('Catatan', $note, inline: false)
            ->link('/host/profile', 'Perbaiki data'), dm: true);
    }

    /** The host takes their request back. */
    public function cancel(ProfileChangeRequest $request): void
    {
        DB::transaction(fn () => $this->lockPending($request)->update(['status' => 'cancelled']));
    }

    /**
     * Call inside a transaction. Approve, reject and cancel lock the request first, so one
     * deciding at the same time as another sees it is no longer pending.
     */
    private function lockPending(ProfileChangeRequest $request): ProfileChangeRequest
    {
        $request = ProfileChangeRequest::whereKey($request->getKey())->lockForUpdate()->firstOrFail();
        if ($request->status !== 'pending') {
            throw ValidationException::withMessages(['request' => ['Permintaan ini sudah diputuskan atau dibatalkan.']]);
        }

        return $request;
    }
}
