<?php

namespace Tests\Feature;

use App\Models\HostProfile;
use App\Models\HostRateCategory;
use App\Models\ProfileChangeRequest;
use App\Models\AppNotification;
use App\Models\User;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class HostProfileTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
    }

    private function activeHost(): User
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();

        return $user->fresh();
    }

    /** A real 1x1 PNG (UploadedFile::fake()->image() needs the GD extension). */
    private function png(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
        ));
    }

    private function category(string $name): HostRateCategory
    {
        return HostRateCategory::where('name', $name)->firstOrFail();
    }

    public function test_approving_a_host_creates_their_profile_as_magang(): void
    {
        $user = User::factory()->pending()->create();
        $user->assignRole('host');

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$user->id}/activate")->assertOk();

        $profile = $user->fresh()->hostProfile;
        $this->assertNotNull($profile);
        $this->assertTrue($profile->join_date->isToday());
        $this->assertSame('Magang', $profile->rateCategory->name);
    }

    public function test_approving_an_operator_does_not_create_a_host_profile(): void
    {
        $user = User::factory()->pending()->create();
        $user->assignRole('operator');

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$user->id}/activate")->assertOk();

        $this->assertNull($user->fresh()->hostProfile);
    }

    public function test_daily_job_moves_hosts_up_by_tenure_but_skips_overrides(): void
    {
        $auto = $this->activeHost()->hostProfile;
        $pinned = $this->activeHost()->hostProfile;

        $auto->update(['join_date' => today()->subMonths(13)]);
        $pinned->update([
            'join_date' => today()->subMonths(13),
            'rate_category_id' => $this->category('Magang')->id,
            'rate_category_overridden' => true,
        ]);

        $this->artisan('hosts:sync-rate-categories')->assertSuccessful();

        $this->assertSame('Di atas 1 tahun', $auto->fresh()->rateCategory->name);
        $this->assertSame('Magang', $pinned->fresh()->rateCategory->name);
    }

    public function test_admin_can_pin_and_unpin_a_rate_level(): void
    {
        $profile = $this->activeHost()->hostProfile;

        $this->actingAs($this->admin)->putJson("/api/admin/hosts/{$profile->id}", [
            'rate_category_id' => $this->category('Baru')->id,
        ])->assertOk()->assertJsonPath('host.rate_category_overridden', true);

        $this->actingAs($this->admin)->putJson("/api/admin/hosts/{$profile->id}", [
            'rate_category_id' => null,
        ])->assertOk()->assertJsonPath('host.rate_category_overridden', false);

        $this->assertSame('Magang', $profile->fresh()->rateCategory->name); // back to tenure-based
    }

    public function test_changing_join_date_recalculates_level(): void
    {
        $profile = $this->activeHost()->hostProfile;

        $this->actingAs($this->admin)->putJson("/api/admin/hosts/{$profile->id}", [
            'join_date' => today()->subMonths(4)->toDateString(),
        ])->assertOk();

        $this->assertSame('Baru', $profile->fresh()->rateCategory->name);
    }

    /** Approve the host's pending change as admin. */
    private function approve(User $host): void
    {
        $id = $this->actingAs($this->admin)->getJson('/api/admin/profile-changes')->assertOk()->json('requests.0.id');
        $this->actingAs($this->admin)->postJson("/api/admin/profile-changes/{$id}/approve")->assertOk();
    }

    public function test_host_personal_data_only_changes_once_an_admin_approves(): void
    {
        $host = $this->activeHost();
        $oldName = $host->name;

        $this->actingAs($host)->putJson('/api/host/profile', [
            'name' => 'New Name',
            'phone' => '081234567890',
            'guardian_phone' => '6281200001111',
            'join_date' => '2020-01-01',
        ])->assertOk()
            ->assertJsonPath('host_profile.phone', null)
            ->assertJsonPath('profile_change.status', 'pending')
            ->assertJsonPath('profile_change.fields.0.label', 'Nama lengkap')
            ->assertJsonPath('profile_change.fields.0.value', 'New Name');

        $this->assertSame($oldName, $host->fresh()->name);
        $this->assertNull($host->hostProfile->fresh()->phone);
        $this->assertDatabaseHas(AppNotification::class, ['user_id' => $this->admin->id, 'type' => 'profile_change_requested']);

        // Admin sees what is saved next to what was asked for
        $this->actingAs($this->admin)->getJson('/api/admin/profile-changes')
            ->assertOk()
            ->assertJsonPath('pending_count', 1)
            ->assertJsonPath('requests.0.fields.0.current', $oldName)
            ->assertJsonPath('requests.0.fields.0.value', 'New Name');

        $this->approve($host);

        $this->assertSame('New Name', $host->fresh()->name);
        $this->assertSame('081234567890', $host->hostProfile->fresh()->phone);
        $this->assertTrue($host->hostProfile->fresh()->join_date->isToday());
        $this->assertDatabaseHas(AppNotification::class, ['user_id' => $host->id, 'type' => 'profile_change_approved']);
        $this->actingAs($host)->getJson('/api/host/profile')->assertJsonPath('profile_change.status', 'approved');
    }

    public function test_more_changes_join_the_pending_request_and_unchanged_values_are_left_out(): void
    {
        $host = $this->activeHost();

        $this->actingAs($host)->putJson('/api/host/profile', ['name' => $host->name, 'phone' => '081234567890'])->assertOk();
        $this->actingAs($host)->putJson('/api/host/profile/sensitive', ['bank_name' => 'BCA'])->assertOk();

        $request = ProfileChangeRequest::sole();
        $this->assertSame(['phone' => '081234567890', 'bank_name' => 'BCA'], $request->new_values);

        // Asking for what is already saved is not a change
        $other = $this->activeHost();
        $this->actingAs($other)->putJson('/api/host/profile', ['name' => $other->name])->assertJsonValidationErrors('changes');
    }

    public function test_admin_rejects_with_a_reason_and_the_host_sees_it(): void
    {
        $host = $this->activeHost();
        $this->actingAs($host)->putJson('/api/host/profile/sensitive', ['bank_name' => 'BCA', 'bank_account' => '1234567890'])->assertOk();
        $id = ProfileChangeRequest::sole()->id;

        $this->actingAs($this->admin)->postJson("/api/admin/profile-changes/{$id}/reject")->assertJsonValidationErrors('note');
        $this->actingAs($this->admin)->postJson("/api/admin/profile-changes/{$id}/reject", ['note' => 'Rekening tidak sesuai nama'])->assertOk();

        $this->assertNull($host->hostProfile->fresh()->sensitiveData);
        $this->actingAs($host)->getJson('/api/host/profile')
            ->assertJsonPath('profile_change.status', 'rejected')
            ->assertJsonPath('profile_change.review_note', 'Rekening tidak sesuai nama');
        $this->actingAs($this->admin)->postJson("/api/admin/profile-changes/{$id}/approve")->assertJsonValidationErrors('request');
    }

    public function test_host_can_cancel_only_their_own_pending_request(): void
    {
        $host = $this->activeHost();
        $this->actingAs($host)->putJson('/api/host/profile', ['phone' => '081234567890'])->assertOk();
        $id = ProfileChangeRequest::sole()->id;

        $this->actingAs($this->activeHost())->postJson("/api/host/profile/changes/{$id}/cancel")->assertForbidden();
        $this->actingAs($host)->postJson("/api/host/profile/changes/{$id}/cancel")->assertOk()->assertJsonPath('profile_change', null);

        $this->assertSame('cancelled', ProfileChangeRequest::sole()->status);
    }

    public function test_only_admins_review_profile_changes(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->getJson('/api/admin/profile-changes')->assertForbidden();
        $this->actingAs($this->activeHost())->getJson('/api/admin/profile-changes')->assertForbidden();
    }

    public function test_contact_numbers_and_bank_details_are_digits_only(): void
    {
        $host = $this->activeHost();

        $this->actingAs($host)->putJson('/api/host/profile', ['phone' => '0812abc4567', 'guardian_phone' => '+62 812 0000 1111'])
            ->assertJsonValidationErrors(['phone', 'guardian_phone']);

        $this->actingAs($host)->putJson('/api/host/profile/sensitive', ['ktp_number' => '32012345678900AB', 'bank_account' => '1234-5678'])
            ->assertJsonValidationErrors(['ktp_number', 'bank_account']);
    }

    public function test_sensitive_data_is_encrypted_and_masked_for_the_host(): void
    {
        $host = $this->activeHost();

        $this->actingAs($host)->putJson('/api/host/profile/sensitive', [
            'ktp_number' => '3201234567890001',
            'bank_name' => 'BCA',
            'bank_account' => '1234567890',
            'account_holder_name' => 'Test Host',
        ])->assertOk()
            ->assertJsonPath('profile_change.fields.0.value', '************0001');

        // Waiting for approval, the numbers are encrypted too
        $this->assertStringNotContainsString('3201234567890001', DB::table('profile_change_requests')->value('new_values'));

        $this->approve($host);
        $this->actingAs($host)->getJson('/api/host/profile')
            ->assertJsonPath('host_profile.sensitive_data.ktp_number_masked', '************0001')
            ->assertJsonPath('host_profile.sensitive_data.bank_account_masked', '******7890')
            ->assertJsonMissingPath('host_profile.sensitive_data.ktp_number');

        $raw = DB::table('host_sensitive_data')->first();
        $this->assertNotSame('3201234567890001', $raw->ktp_number);
        $this->assertStringNotContainsString('1234567890', $raw->bank_account);
    }

    public function test_only_admin_sees_full_sensitive_data(): void
    {
        $host = $this->activeHost();
        $host->hostProfile->sensitiveData()->create(['ktp_number' => '3201234567890001', 'bank_account' => '1234567890']);

        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($this->admin)->getJson("/api/admin/hosts/{$host->hostProfile->id}")
            ->assertOk()
            ->assertJsonPath('host.sensitive_data.ktp_number', '3201234567890001');

        $this->actingAs($operator)->getJson("/api/admin/hosts/{$host->hostProfile->id}")->assertForbidden();
        $this->actingAs($operator)->getJson('/api/operator/hosts')
            ->assertOk()
            ->assertJsonMissingPath('data.0.sensitive_data');
    }

    public function test_profile_photo_upload_sets_avatar_url(): void
    {
        Storage::fake('public');
        $host = $this->activeHost();

        $response = $this->actingAs($host)->postJson('/api/host/profile/photo', [
            'photo' => $this->png('me.png'),
        ])->assertOk();

        $this->assertStringContainsString('/storage/avatars/', $response->json('user.avatar_url'));
    }

    public function test_user_without_host_profile_cannot_save_sensitive_data(): void
    {
        $this->actingAs($this->admin)->putJson('/api/host/profile/sensitive', ['bank_name' => 'BCA'])->assertNotFound();
        $this->actingAs($this->admin)->getJson('/api/host/profile')->assertOk()->assertJsonPath('host_profile', null);
    }

    public function test_rate_level_in_use_cannot_be_deleted(): void
    {
        $this->activeHost();

        $this->actingAs($this->admin)->deleteJson("/api/admin/rate-categories/{$this->category('Magang')->id}")
            ->assertUnprocessable();
        $this->actingAs($this->admin)->deleteJson("/api/admin/rate-categories/{$this->category('Baru')->id}")
            ->assertOk();
    }

    public function test_new_rate_level_replaces_hosts_automatically(): void
    {
        $profile = $this->activeHost()->hostProfile;
        $profile->update(['join_date' => today()->subMonths(7)]);

        $this->actingAs($this->admin)->postJson('/api/admin/rate-categories', [
            'name' => '6 bulan',
            'min_tenure_months' => 6,
            'rate_per_hour' => 15000,
        ])->assertCreated();

        $this->assertSame('6 bulan', $profile->fresh()->rateCategory->name);
    }
}
