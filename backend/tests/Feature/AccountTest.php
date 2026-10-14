<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\BackupApplication;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\HostSensitiveData;
use App\Models\ScheduleSlot;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AccountTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Brand $brand;

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
        $this->brand = Brand::create(['name' => 'Brand A', 'target_hours_per_period' => 100]);
    }

    private function host(): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();
        HostBrandAssignment::create(['host_id' => $user->hostProfile->id, 'brand_id' => $this->brand->id, 'status' => 'active']);

        return $user->hostProfile;
    }

    private function slotFor(HostProfile $host, int $day, string $start, string $end): ScheduleSlot
    {
        return ScheduleSlot::create([
            'assignment_id' => $host->assignments()->first()->id, 'day_of_week' => $day,
            'start_time' => $start, 'end_time' => $end, 'effective_from' => '2026-09-01',
        ]);
    }

    private function openBackup(HostProfile $host, ScheduleSlot $slot, string $date): BackupRequest
    {
        return BackupRequest::findOrFail($this->actingAs($host->user)->postJson('/api/host/backups', [
            'slot_id' => $slot->id, 'backup_date' => $date, 'reason_type' => 'permit',
        ])->assertCreated()->json('request.id'));
    }

    public function test_admin_creates_an_active_account_that_can_sign_in(): void
    {
        $this->actingAs($this->admin)->postJson('/api/admin/users', [
            'name' => 'Nina', 'email' => 'nina@vidhelp.com', 'password' => 'secret123', 'role' => 'host',
        ])->assertCreated()->assertJsonPath('user.status', 'active');

        $nina = User::where('email', 'nina@vidhelp.com')->sole();
        $this->assertSame('admin_created', $nina->signup_source);
        $this->assertSame($this->admin->id, $nina->approved_by);
        $this->assertNotNull($nina->hostProfile);

        $this->postJson('/api/auth/login', ['email' => 'nina@vidhelp.com', 'password' => 'secret123'])
            ->assertOk()
            ->assertJsonStructure(['token']);
    }

    public function test_created_account_needs_a_unique_email_a_real_password_and_a_known_role(): void
    {
        $this->actingAs($this->admin)->postJson('/api/admin/users', [
            'name' => 'Copy', 'email' => 'admin@vidhelp.com', 'password' => 'short', 'role' => 'boss',
        ])->assertJsonValidationErrors(['email', 'password', 'role']);
    }

    public function test_admins_cannot_change_their_own_role_or_archive_themselves(): void
    {
        $this->actingAs($this->admin)->putJson("/api/admin/users/{$this->admin->id}", ['role' => 'host'])
            ->assertJsonValidationErrors(['role' => 'peranmu sendiri']);
        $this->actingAs($this->admin)->postJson("/api/admin/users/{$this->admin->id}/archive")
            ->assertJsonValidationErrors(['status' => 'akunmu sendiri']);

        $this->assertTrue($this->admin->fresh()->hasRole('admin'));
        $this->assertSame('active', $this->admin->fresh()->status);

        // Another admin may change them
        $second = User::factory()->create();
        $second->assignRole('admin');
        $this->actingAs($second)->putJson("/api/admin/users/{$this->admin->id}", ['role' => 'finance'])->assertOk();
    }

    public function test_deactivating_is_temporary_and_keeps_the_schedule(): void
    {
        $host = $this->host();
        $slot = $this->slotFor($host, 2, '14:00', '16:00');

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$host->user_id}/deactivate")->assertOk();

        $this->assertSame('inactive', $host->fresh()->status);
        $this->assertNull($slot->fresh()->effective_to);

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$host->user_id}/activate")->assertOk();
        $this->assertSame('active', $host->fresh()->status);
    }

    public function test_archiving_a_host_takes_them_off_the_schedule(): void
    {
        $host = $this->host();
        $slot = $this->slotFor($host, 2, '14:00', '16:00');
        $ownRequest = $this->openBackup($host, $slot, '2026-10-13');

        // They cover someone else's slot, and applied to cover another
        $colleague = $this->host();
        $covered = $this->openBackup($colleague, $this->slotFor($colleague, 3, '10:00', '12:00'), '2026-10-07');
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$covered->id}/assign", ['host_id' => $host->id])->assertOk();
        $applied = $this->openBackup($colleague, $this->slotFor($colleague, 4, '10:00', '12:00'), '2026-10-08');
        $this->actingAs($host->user)->postJson("/api/host/backups/{$applied->id}/apply")->assertOk();

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$host->user_id}/archive")->assertOk();

        $this->assertSame('archived', $host->user->fresh()->status);
        $this->assertSame('archived', $host->fresh()->status);
        $this->assertSame('2026-10-04', $slot->fresh()->effective_to->toDateString()); // ended yesterday
        $this->assertSame('inactive', $host->assignments()->first()->status);
        $this->assertSame('cancelled', $ownRequest->fresh()->status);
        $this->assertSame('open', $covered->fresh()->status);
        $this->assertSame('open', $applied->fresh()->status);
        $this->assertSame('withdrawn', BackupApplication::where('backup_request_id', $applied->id)->value('status'));

        $this->postJson('/api/auth/login', ['email' => $host->user->email, 'password' => 'password'])->assertJsonValidationErrors('email');
    }

    public function test_delete_permanently_needs_an_archived_account_and_a_valid_reason(): void
    {
        $host = $this->host();
        $erase = fn (array $body) => $this->actingAs($this->admin)->postJson("/api/admin/users/{$host->user_id}/erase", $body);

        $erase(['reason' => 'host_request'])->assertJsonValidationErrors(['reason' => 'Arsipkan akunnya dulu']);

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$host->user_id}/archive")->assertOk();

        $erase(['reason' => 'other'])->assertJsonValidationErrors('reason');
        $erase(['reason' => 'banned'])->assertJsonValidationErrors(['reason' => 'tidak diblokir']);

        $host->assignments()->update(['status' => 'banned']);
        $erase(['reason' => 'banned'])->assertOk();
        $erase(['reason' => 'banned'])->assertJsonValidationErrors(['reason' => 'sudah dihapus']);
    }

    public function test_delete_permanently_wipes_personal_data_but_keeps_the_history(): void
    {
        $host = $this->host();
        $user = $host->user;
        $oldEmail = $user->email;
        $host->update(['phone' => '081234567890']);
        HostSensitiveData::create([
            'host_id' => $host->id, 'ktp_number' => '3171234567890001', 'bank_name' => 'BCA',
            'bank_account' => '1234567890', 'account_holder_name' => $user->name,
        ]);
        AppNotification::create(['user_id' => $user->id, 'type' => 'test', 'title' => 'Hi', 'channel' => 'web', 'status' => 'sent']);
        $this->actingAs($this->admin)->postJson("/api/admin/users/{$user->id}/archive")->assertOk();

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$user->id}/erase", ['reason' => 'host_request', 'note' => 'Asked by WhatsApp'])
            ->assertOk();

        $user->refresh();
        $this->assertNotNull($user->erased_at);
        $this->assertStringStartsWith('Pengguna terhapus ', $user->name);
        $this->assertNotSame($oldEmail, $user->email);
        $this->assertNull($user->password);
        $this->assertNull($host->fresh()->phone);
        $this->assertSame(0, HostSensitiveData::count());
        $this->assertSame(0, AppNotification::where('user_id', $user->id)->count());
        $this->assertTrue(HostProfile::whereKey($host->id)->exists()); // history stays attached

        // The audit trail no longer holds the old name or email
        $this->assertFalse(AuditLog::where('target_table', 'users')->where('target_id', $user->id)->whereNotNull('new_value')->where('action', '!=', 'erase')->exists());
        $this->assertFalse(AuditLog::where('target_label', 'like', "%{$oldEmail}%")->exists());
        $this->assertSame('host_request', AuditLog::where('action', 'erase')->sole()->new_value['reason']);

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$user->id}/activate")->assertJsonValidationErrors('status');
    }

    public function test_finance_runs_payroll_but_nothing_else(): void
    {
        $finance = User::factory()->create();
        $finance->assignRole('finance');

        $this->actingAs($finance)->getJson('/api/finance/payroll/periods')->assertOk();
        $this->actingAs($finance)->getJson('/api/finance/cash-advances')->assertOk();
        $this->actingAs($finance)->getJson('/api/finance/hosts')->assertOk();
        $this->actingAs($finance)->getJson('/api/finance/brands')->assertOk()->assertJsonPath('brands.0.name', 'Brand A');

        $this->actingAs($finance)->getJson('/api/admin/users')->assertForbidden();
        $this->actingAs($finance)->getJson('/api/operator/schedules')->assertForbidden();

        $host = $this->host();
        $this->actingAs($host->user)->getJson('/api/finance/payroll/periods')->assertForbidden();
        $this->actingAs($this->admin)->getJson('/api/finance/payroll/periods')->assertOk();
    }
}
