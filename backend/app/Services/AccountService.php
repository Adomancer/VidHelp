<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\Attendance;
use App\Models\AuditLog;
use App\Models\BackupApplication;
use App\Models\BackupRequest;
use App\Models\EventSlotClaim;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Account lifecycle: an admin creating an account, and the status changes after it.
 *
 * active ⇄ inactive (temporary, e.g. leave: can't sign in, schedule stays)
 * active/inactive → archived (resigned: can't sign in, taken off the schedule from today)
 * archived → erased ("delete permanently": personal data wiped, work and pay history kept)
 *
 * The host profile's status always follows the account's.
 */
class AccountService
{
    public function __construct(private BackupService $backups, private EventService $events) {}

    /**
     * An account made by an admin: active straight away (no approval step).
     */
    public function create(array $attributes, User $by): User
    {
        return DB::transaction(function () use ($attributes, $by) {
            $user = User::create([
                'name' => $attributes['name'],
                'email' => $attributes['email'],
                'password' => Hash::make($attributes['password']),
                'status' => 'active',
                'signup_source' => 'admin_created',
                'approved_by' => $by->id,
                'approved_at' => now(),
            ]);
            $user->assignRole($attributes['role']);
            $user->ensureHostProfile();

            return $user;
        });
    }

    /**
     * Change the account's status (active | inactive | archived). Signing out happens
     * for anything but active; archiving also takes a host off the schedule.
     */
    public function setStatus(User $user, string $status, User $by): void
    {
        if ($user->erased_at) {
            $this->fail('status', 'This account was deleted permanently.');
        }
        // The acting admin stays active, so this also means there is always an admin left
        if ($status !== 'active' && $user->is($by)) {
            $this->fail('status', 'You cannot deactivate or archive your own account.');
        }

        DB::transaction(function () use ($user, $status) {
            $user->update(['status' => $status]);

            if ($status !== 'active') {
                $user->tokens()->delete();
            }

            $user->ensureHostProfile();
            $user->hostProfile?->update(['status' => $status]);

            if ($status === 'archived' && $user->hostProfile) {
                $this->takeOffSchedule($user->hostProfile);
            }
        });
    }

    /**
     * Changing a role: never your own (so the acting admin always stays one).
     */
    public function ensureRoleCanChange(User $user, User $by): void
    {
        if ($user->is($by)) {
            $this->fail('role', 'You cannot change your own role.');
        }
    }

    /**
     * "Delete permanently" for an archived account: allowed when the host is banned from a
     * brand or asked to be deleted. Sign-in details, contact data, KTP, bank details, photos
     * and sick letters are wiped, and the audit trail forgets the old values; work sessions,
     * points and pay stay under an anonymous name.
     */
    public function erase(User $user, string $reason, ?string $note, User $by): void
    {
        if ($user->status !== 'archived' || $user->erased_at) {
            $this->fail('reason', $user->erased_at ? 'This account was already deleted.' : 'Archive the account first.');
        }

        $host = $user->hostProfile;
        if ($reason === 'banned' && ! $host?->assignments()->where('status', 'banned')->exists()) {
            $this->fail('reason', 'This host is not banned from any brand.');
        }

        $label = 'Deleted user '.substr($user->id, 0, 8);
        $oldEmail = $user->email;
        $sensitiveId = $host?->sensitiveData?->id;

        DB::transaction(function () use ($user, $host, $label, $oldEmail, $sensitiveId) {
            // Without model events: the Auditable trait would otherwise log the old values we are wiping
            Model::withoutEvents(function () use ($user, $host, $label) {
                if ($user->avatar && ! str_starts_with($user->avatar, 'http')) {
                    Storage::disk('public')->delete($user->avatar);
                }

                if ($host) {
                    if ($path = $host->sensitiveData?->ktp_image_path) {
                        Storage::disk('local')->delete($path);
                    }
                    $host->sensitiveData()->delete();
                    $host->availability()->delete();
                    $host->update(['phone' => null, 'guardian_phone' => null]);

                    // Sick letters are health data
                    BackupRequest::where('requesting_host_id', $host->id)->with('attachments')->get()
                        ->flatMap->attachments
                        ->each(function ($attachment) {
                            Storage::disk('local')->delete($attachment->file_path);
                            $attachment->delete();
                        });
                }

                $user->tokens()->delete();
                $user->twoFactorAuth()->delete();
                $user->discordLink()->delete();
                AppNotification::where('user_id', $user->id)->delete();

                $user->forceFill([
                    'name' => $label,
                    'email' => "erased-{$user->id}@deleted.invalid",
                    'password' => null,
                    'google_id' => null,
                    'avatar' => null,
                    'remember_token' => null,
                    'erased_at' => now(),
                ])->save();
            });

            DB::table('password_reset_tokens')->where('email', $oldEmail)->delete();

            // Old audit rows about this person held their name, email, phone and bank name
            $targets = ['users' => $user->id, 'host_profiles' => $host?->id, 'host_sensitive_data' => $sensitiveId];
            foreach (array_filter($targets) as $table => $id) {
                AuditLog::where('target_table', $table)->where('target_id', $id)
                    ->update(['old_value' => null, 'new_value' => null, 'target_label' => $label]);
            }
        });

        AuditLog::record('erase', $user, new: ['reason' => $reason, 'note' => $note], actor: $by, label: $label);
    }

    /**
     * Resigned host: end their weekly slots from today, cancel their own backup requests,
     * give back covers and event blocks they took, and withdraw pending applications.
     */
    private function takeOffSchedule(HostProfile $host): void
    {
        ScheduleSlot::where('status', 'active')
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id))
            ->get()
            ->each(fn (ScheduleSlot $slot) => $slot->retire());
        $host->assignments()->where('status', 'active')->update(['status' => 'inactive']);

        BackupRequest::where('requesting_host_id', $host->id)
            ->whereIn('status', ['open', 'pending', 'filled'])
            ->where('start_at', '>', now())
            ->get()
            ->each(fn (BackupRequest $request) => $this->backups->close($request, 'cancelled'));

        BackupRequest::where('filled_by_host_id', $host->id)
            ->where('status', 'filled')
            ->where('start_at', '>', now())
            ->with(['filler.user', 'brand'])
            ->get()
            ->each(fn (BackupRequest $request) => $this->backups->unfill($request, 'rejected'));

        BackupApplication::where('applicant_host_id', $host->id)
            ->where('status', 'applied')
            ->with('request')
            ->get()
            ->each(fn (BackupApplication $application) => $this->backups->withdraw($application->request, $host));

        // Blocks they already checked in for stay (release() refuses them)
        EventSlotClaim::active()
            ->where('host_id', $host->id)
            ->where('start_at', '>', now())
            ->whereNotIn('id', Attendance::whereNotNull('event_claim_id')->select('event_claim_id'))
            ->get()
            ->each(fn (EventSlotClaim $claim) => $this->events->release($claim, asManager: true));
    }

    private function fail(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => [$message]]);
    }
}
