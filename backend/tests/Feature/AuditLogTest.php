<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Brand;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
        $this->admin = User::factory()->create(['name' => 'Boss']);
        $this->admin->assignRole('admin');
    }

    public function test_model_changes_are_recorded_with_who_and_what(): void
    {
        $brand = $this->actingAs($this->admin)->postJson('/api/admin/brands', [
            'name' => 'Glow Skincare',
            'target_hours_per_period' => 100,
        ])->assertCreated()->json('brand.id');

        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$brand}", ['target_hours_per_period' => 120])->assertOk();

        $created = AuditLog::where(['action' => 'create', 'target_table' => 'brands'])->sole();
        $this->assertSame($this->admin->id, $created->user_id);
        $this->assertSame('Glow Skincare', $created->target_label);
        $this->assertSame('Glow Skincare', $created->new_value['name']);
        $this->assertSame('127.0.0.1', $created->ip_address);

        $updated = AuditLog::where(['action' => 'update', 'target_table' => 'brands'])->sole();
        $this->assertEquals(['target_hours_per_period' => 100], $updated->old_value);
        $this->assertEquals(['target_hours_per_period' => 120], $updated->new_value);
    }

    public function test_secrets_are_never_written_to_the_log(): void
    {
        $host = User::factory()->create();
        $host->assignRole('host');
        $host->ensureHostProfile();

        $this->actingAs($host)->postJson('/api/host/profile/password', [
            'current_password' => 'password',
            'password' => 'brand-new-secret',
            'password_confirmation' => 'brand-new-secret',
        ])->assertOk();
        $this->actingAs($host)->putJson('/api/host/profile/sensitive', ['ktp_number' => '3201234567890001', 'bank_account' => '1234567890'])
            ->assertOk();
        $change = \App\Models\ProfileChangeRequest::sole();
        $this->actingAs($this->admin)->postJson("/api/admin/profile-changes/{$change->id}/approve", ['version' => $change->version()])->assertOk();
        $this->assertSame('[hidden]', AuditLog::where(['action' => 'create', 'target_table' => 'profile_change_requests'])->sole()->new_value['new_values']);

        $password = AuditLog::where(['action' => 'update', 'target_table' => 'users', 'target_id' => $host->id])->sole();
        $this->assertSame(['password' => '[hidden]'], $password->new_value);

        $sensitive = AuditLog::where(['target_table' => 'host_sensitive_data'])->sole();
        $this->assertSame('[hidden]', $sensitive->new_value['ktp_number']);
        $this->assertSame('[hidden]', $sensitive->new_value['bank_account']);
        $this->assertStringNotContainsString('3201234567890001', AuditLog::pluck('new_value')->toJson());
    }

    public function test_logins_failures_approvals_and_role_changes_are_recorded(): void
    {
        $user = User::factory()->create(['email' => 'new@vidhelp.com', 'status' => 'pending', 'approved_at' => null]);
        $user->assignRole('host');

        $this->postJson('/api/auth/login', ['email' => 'new@vidhelp.com', 'password' => 'wrong'])->assertUnprocessable();
        $this->actingAs($this->admin)->postJson("/api/admin/users/{$user->id}/activate")->assertOk();
        $this->actingAs($this->admin)->putJson("/api/admin/users/{$user->id}", ['role' => 'operator'])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => 'new@vidhelp.com', 'password' => 'password'])->assertOk();

        $failed = AuditLog::where('action', 'login_failed')->sole();
        $this->assertNull($failed->user_id);
        $this->assertSame($user->id, $failed->target_id);

        $this->assertDatabaseHas('audit_logs', ['action' => 'approve', 'user_id' => $this->admin->id, 'target_id' => $user->id]);
        $role = AuditLog::where('action', 'role_change')->sole();
        $this->assertSame(['roles' => ['host']], $role->old_value);
        $this->assertSame(['roles' => ['operator']], $role->new_value);
        $this->assertDatabaseHas('audit_logs', ['action' => 'login', 'user_id' => $user->id]);

        // last_login_at alone doesn't create update rows
        $this->assertSame(0, AuditLog::where(['action' => 'update', 'target_id' => $user->id])
            ->get()->filter(fn ($log) => array_keys($log->new_value) === ['last_login_at'])->count());
    }

    public function test_admin_can_filter_the_log_and_others_cannot_see_it(): void
    {
        Brand::create(['name' => 'Glow', 'target_hours_per_period' => 100]);
        AuditLog::record('login', $this->admin, actor: $this->admin);

        $this->actingAs($this->admin)->getJson('/api/admin/audit-logs?action=login')
            ->assertOk()
            ->assertJsonCount(1, 'logs.data')
            ->assertJsonPath('logs.data.0.user.name', 'Boss')
            ->assertJsonPath('actions', ['create', 'login']);

        $this->actingAs($this->admin)->getJson('/api/admin/audit-logs?search=Glow')->assertJsonCount(1, 'logs.data');

        $operator = User::factory()->create();
        $operator->assignRole('operator');
        $this->actingAs($operator)->getJson('/api/admin/audit-logs')->assertForbidden();
    }
}
