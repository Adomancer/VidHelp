<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\BackupQuota;
use App\Models\SystemSetting;
use App\Models\User;
use App\Services\PointService;
use App\Services\SettingsService;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class SettingsTest extends TestCase
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

    private function save(array $values): TestResponse
    {
        return $this->actingAs($this->admin)->putJson('/api/admin/settings', ['values' => $values]);
    }

    /** Simulate the next request: the saved overrides are layered onto a fresh config. */
    private function rebootConfig(): void
    {
        config(['vidhelp' => require config_path('vidhelp.php')]);
        $this->app->forgetInstance(SettingsService::class);
        $this->app->make(SettingsService::class)->apply();
    }

    public function test_admin_sees_every_setting_with_its_default(): void
    {
        $groups = $this->actingAs($this->admin)->getJson('/api/admin/settings')->assertOk()->json('groups');

        $settings = collect($groups)->flatMap(fn ($group) => $group['settings'])->keyBy('key');
        $this->assertCount(count(SettingsService::DEFINITIONS), $settings);
        $this->assertSame(3, $settings['backup.quota_per_month']['value']);
        $this->assertSame(3, $settings['backup.quota_per_month']['default']);
        $this->assertNull($settings['backup.quota_per_month']['changed_by']);
    }

    public function test_saved_value_overrides_config_and_is_audited(): void
    {
        $this->save(['backup.auto_open_after_minutes' => 45])
            ->assertOk()
            ->assertJsonPath('message', 'Setting saved.');

        $this->rebootConfig();
        $this->assertSame(45, config('vidhelp.backup.auto_open_after_minutes'));

        $row = SystemSetting::where('key', 'backup.auto_open_after_minutes')->sole();
        $this->assertSame($this->admin->id, $row->updated_by);

        $audit = AuditLog::where(['action' => 'create', 'target_table' => 'system_settings'])->sole();
        $this->assertSame('backup.auto_open_after_minutes', $audit->target_label);
        $this->assertSame(45, $audit->new_value['value']);

        $this->getJson('/api/admin/settings')
            ->assertJsonPath('groups.0.settings.1.changed_by', 'Boss');
    }

    public function test_setting_back_to_the_default_removes_the_override(): void
    {
        $this->save(['points.starting_points' => 120])->assertOk();
        $this->save(['points.starting_points' => 100])->assertOk();

        $this->assertDatabaseMissing('system_settings', ['key' => 'points.starting_points']);
        $this->rebootConfig();
        $this->assertSame(100, config('vidhelp.points.starting_points'));
    }

    public function test_values_are_checked_against_their_limits(): void
    {
        $this->save([
            'backup.quota_per_month' => -1,
            'points.reset_every_months' => 5,
            'two_factor.required_for_admins' => 'maybe',
            'nope' => 1,
        ])->assertUnprocessable()->assertJsonValidationErrors([
            'backup.quota_per_month', 'points.reset_every_months', 'two_factor.required_for_admins', 'nope',
        ]);

        $this->assertSame(0, SystemSetting::count());
    }

    public function test_sp_thresholds_must_go_down_and_stay_below_starting_points(): void
    {
        $this->save(['points.sp_thresholds.2' => 80])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['points.sp_thresholds.2' => 'SP2 must be below SP1 (75).']);

        $this->save(['points.starting_points' => 70])
            ->assertJsonValidationErrors(['points.sp_thresholds.1' => 'SP1 must be below the starting points (70).']);

        $this->save(['points.sp_thresholds.1' => 90, 'points.sp_thresholds.2' => 80, 'points.sp_thresholds.3' => 70])->assertOk();
        $this->assertSame(2, app(PointService::class)->levelFor(80));
    }

    public function test_quota_change_also_applies_to_this_month(): void
    {
        $host = User::factory()->create();
        $host->assignRole('host');
        $host->ensureHostProfile();
        $quota = BackupQuota::for($host->hostProfile->id, now()->format('Y-m'));

        $this->save(['backup.quota_per_month' => 5])->assertOk();

        $this->assertSame(5, $quota->fresh()->quota_max);
    }

    public function test_2fa_requirement_can_be_switched_from_the_page(): void
    {
        $this->save(['two_factor.required_for_admins' => true])->assertOk();

        $this->rebootConfig();
        $this->actingAs($this->admin)->getJson('/api/admin/dashboard')
            ->assertForbidden()
            ->assertJsonPath('code', 'two_factor_setup_required');
    }

    public function test_everyone_can_read_help_text_numbers_but_only_admins_change_settings(): void
    {
        $host = User::factory()->create();
        $host->assignRole('host');

        $this->actingAs($host)->getJson('/api/settings')
            ->assertOk()
            ->assertJsonPath('settings', [
                'backup.auto_open_after_minutes' => 30,
                'backup.auto_fill_before_minutes' => 30,
                'backup.sick_letter_grace_hours' => 24,
                'backup.quota_per_month' => 3,
            ]);

        $this->actingAs($host)->putJson('/api/admin/settings', ['values' => ['backup.quota_per_month' => 9]])->assertForbidden();
    }
}
