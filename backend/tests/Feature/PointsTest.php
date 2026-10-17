<?php

namespace Tests\Feature;

use App\Models\Attachment;
use App\Models\BackupApplication;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\HostRating;
use App\Models\PointLog;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\ViolationType;
use App\Models\WarningLetter;
use App\Services\PointService;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Database\Seeders\ViolationTypeSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PointsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $operator;

    private HostProfile $host;

    private Brand $brand;

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday, Q4
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class, ViolationTypeSeeder::class]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
        $this->operator = User::factory()->create();
        $this->operator->assignRole('operator');

        $this->brand = Brand::create(['name' => 'Brand A', 'target_hours_per_period' => 100]);
        $this->host = $this->newHost();
    }

    private function newHost(): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();
        HostBrandAssignment::create(['host_id' => $user->hostProfile->id, 'brand_id' => $this->brand->id, 'status' => 'active']);

        return $user->hostProfile;
    }

    private function type(string $name): ViolationType
    {
        return ViolationType::where('name', $name)->firstOrFail();
    }

    private function violation(array $data = [])
    {
        return $this->actingAs($this->operator)->postJson('/api/operator/points/violations', $data + [
            'host_id' => $this->host->id,
            'violation_type_id' => $this->type('Telat')->id,
        ]);
    }

    private function points(?HostProfile $host = null): int
    {
        return $this->actingAs($this->operator)->getJson('/api/operator/points/hosts/'.($host ?? $this->host)->id)->json('points');
    }

    public function test_points_periods_are_three_calendar_months(): void
    {
        $service = app(PointService::class);

        [$start, $end] = $service->periodFor('2026-11-15');
        $this->assertSame(['2026-10-01', '2026-12-31'], [$start->toDateString(), $end->toDateString()]);

        [$start, $end] = $service->periodFor('2026-01-31');
        $this->assertSame(['2026-01-01', '2026-03-31'], [$start->toDateString(), $end->toDateString()]);
    }

    public function test_operator_records_a_violation_with_default_or_custom_points(): void
    {
        $this->violation()->assertCreated()->assertJsonPath('points', 95); // Telat = 5
        $this->violation(['points' => 12, 'reason' => 'Late 40 minutes'])->assertJsonPath('points', 83);

        $this->assertSame(83, $this->points());
        $this->actingAs($this->operator)->getJson('/api/operator/points')
            ->assertJsonPath('hosts.0.host_id', $this->host->id)
            ->assertJsonPath('hosts.0.points', 83)
            ->assertJsonPath('hosts.0.deductions', 2);
    }

    public function test_sp_is_issued_automatically_once_per_level(): void
    {
        $this->violation(['points' => 20])->assertJsonPath('warning_letter', null); // 80
        $this->violation(['points' => 5])->assertJsonPath('warning_letter.level', 1); // 75 → SP1
        $this->violation(['points' => 5])->assertJsonPath('warning_letter', null); // 70, SP1 already
        $this->violation(['points' => 20])->assertJsonPath('warning_letter.level', 2); // 50 → SP2

        $this->assertSame([1, 2], WarningLetter::orderBy('level')->pluck('level')->all());
    }

    public function test_a_big_drop_issues_only_the_highest_level(): void
    {
        $this->violation(['points' => 60])->assertJsonPath('warning_letter.level', 2); // 40

        $this->assertSame(1, WarningLetter::count());
    }

    public function test_points_reset_in_the_next_three_month_period(): void
    {
        $this->violation(['points' => 30, 'occurred_on' => '2026-09-30'])->assertCreated(); // Q3
        $this->violation(['points' => 10])->assertCreated(); // Q4

        $this->assertSame(90, $this->points());
        $this->assertSame(70, $this->actingAs($this->operator)
            ->getJson("/api/operator/points/hosts/{$this->host->id}?on=2026-08-01")->json('points'));
    }

    public function test_admin_cancels_a_wrong_entry_but_operator_cannot(): void
    {
        $id = $this->violation(['points' => 30])->json('log.id');

        $this->actingAs($this->operator)->postJson("/api/admin/points/logs/{$id}/void")->assertForbidden();
        $this->actingAs($this->admin)->postJson("/api/admin/points/logs/{$id}/void")->assertOk()->assertJsonPath('points', 100);
        $this->actingAs($this->admin)->postJson("/api/admin/points/logs/{$id}/void")->assertJsonValidationErrors('log');
    }

    public function test_admin_issues_and_cancels_an_sp_by_hand(): void
    {
        $id = $this->actingAs($this->admin)->postJson('/api/admin/warning-letters', [
            'host_id' => $this->host->id, 'level' => 1, 'reason' => 'Repeated no-show',
        ])->assertCreated()->json('warning_letter.id');

        $this->actingAs($this->admin)->postJson("/api/admin/warning-letters/{$id}/void")->assertOk();

        $this->actingAs($this->host->user)->getJson('/api/host/performance')->assertJsonCount(0, 'warning_letters');
    }

    public function test_brand_complaint_deducts_points(): void
    {
        $this->actingAs($this->operator)->postJson('/api/operator/points/complaints', [
            'host_id' => $this->host->id,
            'brand_id' => $this->brand->id,
            'description' => 'Host read the wrong promo code',
        ])->assertCreated()->assertJsonPath('points', 90);

        $log = PointLog::firstOrFail();
        $this->assertSame('brand_complaint', $log->source);
        $this->assertNotNull($log->brand_complaint_id);
    }

    public function test_switched_off_complaint_type_records_without_points(): void
    {
        $this->type('Komplain brand')->update(['is_active' => false]);

        $this->actingAs($this->operator)->postJson('/api/operator/points/complaints', [
            'host_id' => $this->host->id, 'brand_id' => $this->brand->id, 'description' => 'Late start',
        ])->assertCreated();

        $this->assertSame(0, PointLog::count());
        $this->assertSame(100, $this->points());
    }

    public function test_inactive_type_cannot_be_recorded(): void
    {
        $this->type('Telat')->update(['is_active' => false]);

        $this->violation()->assertJsonValidationErrors('violation_type_id');
    }

    public function test_dropping_a_picked_backup_deducts_points(): void
    {
        $cover = $this->newHost();
        $backup = $this->filledBackup($cover);

        $this->actingAs($cover->user)->postJson("/api/host/backups/{$backup->id}/drop")->assertOk();

        $log = PointLog::where('host_id', $cover->id)->firstOrFail();
        $this->assertSame('backup_cancel', $log->source);
        $this->assertSame(-10, $log->points_change);
        $this->assertTrue(BackupApplication::where('applicant_host_id', $cover->id)->firstOrFail()->penalty_applied);
    }

    public function test_late_or_missing_sick_letter_is_penalized_once(): void
    {
        $missing = $this->filledBackup($this->newHost(), 'sick');
        $onTime = $this->filledBackup($this->newHost(), 'sick', '2026-10-06 18:00', '2026-10-06 20:00');
        Attachment::create([
            'owner_type' => 'backup_request', 'owner_id' => $onTime->id, 'file_path' => 'x.pdf',
            'mime_type' => 'application/pdf', 'size_kb' => 1,
        ]);

        $this->travelTo(CarbonImmutable::parse('2026-10-08 12:00')); // both letters are past due
        $this->artisan('points:apply-penalties')->assertSuccessful();
        $this->artisan('points:apply-penalties')->assertSuccessful();

        $this->assertSame(1, PointLog::where('source', 'late_attachment')->count());
        $this->assertSame($missing->requesting_host_id, PointLog::where('source', 'late_attachment')->value('host_id'));
        $this->assertTrue($onTime->fresh()->letter_penalty_applied);
    }

    public function test_rating_suggestion_uses_the_months_violations(): void
    {
        $this->violation(['violation_type_id' => $this->type('Main HP saat live')->id]); // impact 0.5
        $this->violation(); // Telat, impact 0.2

        $row = collect($this->actingAs($this->admin)->getJson('/api/admin/ratings?month=2026-10')->json('hosts'))
            ->firstWhere('host_id', $this->host->id);

        $this->assertSame(4.3, $row['suggested']);
        $this->assertSame(2, $row['violations']);
        $this->assertNull($row['rating']);
    }

    public function test_admin_rates_and_host_sees_it(): void
    {
        $this->actingAs($this->operator)->putJson('/api/admin/ratings', [
            'host_id' => $this->host->id, 'month_year' => '2026-10', 'rating' => 4,
        ])->assertForbidden();

        $this->actingAs($this->admin)->putJson('/api/admin/ratings', [
            'host_id' => $this->host->id, 'month_year' => '2026-10', 'rating' => 4.5, 'note' => 'Great energy',
        ])->assertOk();
        $this->actingAs($this->admin)->putJson('/api/admin/ratings', [
            'host_id' => $this->host->id, 'month_year' => '2026-10', 'rating' => 4.2,
        ])->assertOk();

        $this->assertSame(1, HostRating::count());
        $this->actingAs($this->host->user)->getJson('/api/host/performance')
            ->assertJsonPath('points', 100)
            ->assertJsonPath('ratings.0.rating', 4.2);
    }

    public function test_admin_exports_ratings_with_point_and_sp_history_of_the_month(): void
    {
        $this->violation(['reason' => 'Late 20 minutes'])->assertCreated();
        $this->actingAs($this->admin)->postJson('/api/admin/warning-letters', [
            'host_id' => $this->host->id, 'level' => 1, 'reason' => 'Repeated no-show',
        ])->assertCreated();
        $this->actingAs($this->admin)->putJson('/api/admin/ratings', [
            'host_id' => $this->host->id, 'month_year' => '2026-10', 'rating' => 4.2, 'note' => 'Good',
        ])->assertOk();
        $name = $this->host->user->name;

        $sheets = $this->xlsxSheets(
            $this->actingAs($this->admin)->get('/api/admin/ratings/export?month=2026-10')
                ->assertOk()
                ->assertDownload('ratings-2026-10.xlsx')
        );

        $this->assertSame(['Ringkasan', 'Rating', 'Riwayat Poin', 'Surat Peringatan'], array_keys($sheets));
        $this->assertSame(1, $this->xlsxValue($sheets['Ringkasan'], 'Sudah dinilai'));

        $rating = collect($this->xlsxTable($sheets['Rating'], 'No'))->firstWhere(1, $name);
        $this->assertEquals([$name, 1, 4.8, 4.2, 'Sudah dinilai', 'Good', $this->admin->name], array_slice($rating, 1));
        $this->assertEquals([$name, 'Telat', -5, 'Late 20 minutes'], array_slice($this->xlsxTable($sheets['Riwayat Poin'], 'Tanggal')[1], 1, 4));
        $this->assertSame([$name, 'SP1', 'Repeated no-show', $this->admin->name, 'Berlaku'], array_slice($this->xlsxTable($sheets['Surat Peringatan'], 'Terbit')[1], 1));
    }

    public function test_points_period_exports_balances_history_and_violation_types(): void
    {
        $this->violation(['reason' => 'Late 20 minutes'])->assertCreated();
        $name = $this->host->user->name;

        $sheets = $this->xlsxSheets($this->actingAs($this->admin)->get('/api/operator/points/export')->assertOk());

        $this->assertSame(['Ringkasan', 'Saldo Poin', 'Riwayat Poin', 'Surat Peringatan', 'Jenis Pelanggaran'], array_keys($sheets));
        $this->assertSame(1, $this->xlsxValue($sheets['Ringkasan'], 'Catatan poin'));
        $balance = collect($this->xlsxTable($sheets['Saldo Poin'], 'No'))->firstWhere(1, $name);
        $this->assertSame([95, 'Aman', 1, 5], array_slice($balance, 3));
        $this->assertSame('Late 20 minutes', $this->xlsxTable($sheets['Riwayat Poin'], 'Tanggal')[1][4]);
        $this->assertContains('Telat', array_column($this->xlsxTable($sheets['Jenis Pelanggaran'], 'Jenis'), 0));
    }

    public function test_admin_sees_a_hosts_full_point_and_sp_history(): void
    {
        $this->violation()->assertCreated();
        $this->travelTo(CarbonImmutable::parse('2027-01-10 10:00')); // next three-month period
        $this->violation()->assertCreated();
        $this->actingAs($this->admin)->postJson('/api/admin/warning-letters', [
            'host_id' => $this->host->id, 'level' => 2, 'reason' => 'Second warning',
        ])->assertCreated();

        $this->actingAs($this->admin)->getJson("/api/admin/ratings/hosts/{$this->host->id}/history")
            ->assertOk()
            ->assertJsonCount(2, 'logs')
            ->assertJsonPath('logs.0.occurred_on', '2027-01-10')
            ->assertJsonPath('logs.1.violation_type.name', 'Telat')
            ->assertJsonPath('warning_letters.0.level', 2);

        $this->actingAs($this->operator)->getJson("/api/admin/ratings/hosts/{$this->host->id}/history")->assertForbidden();
        $this->actingAs($this->operator)->get('/api/admin/ratings/export')->assertForbidden();
    }

    public function test_admin_gives_the_suggestion_to_every_host_not_yet_rated(): void
    {
        $this->violation(); // Telat, impact 0.2
        $rated = $this->newHost();
        $this->actingAs($this->admin)->putJson('/api/admin/ratings', ['host_id' => $rated->id, 'month_year' => '2026-10', 'rating' => 3])->assertOk();
        $inactive = $this->newHost();
        $inactive->update(['status' => 'inactive']);

        $this->actingAs($this->admin)->postJson('/api/admin/ratings/apply-suggested', ['month_year' => '2026-10'])
            ->assertOk()
            ->assertJsonPath('rated', 1)
            ->assertJsonPath('message', '1 host diberi rating saran');

        $this->assertSame(4.8, HostRating::where('host_id', $this->host->id)->value('rating'));
        $this->assertSame($this->admin->id, HostRating::where('host_id', $this->host->id)->value('rated_by'));
        $this->assertSame(3.0, HostRating::where('host_id', $rated->id)->value('rating'));
        $this->assertDatabaseMissing(HostRating::class, ['host_id' => $inactive->id]);
    }

    public function test_suggestions_for_one_brand_rate_only_its_hosts(): void
    {
        $other = Brand::create(['name' => 'Brand B', 'target_hours_per_period' => 100]);
        $elsewhere = User::factory()->create();
        $elsewhere->assignRole('host');
        $elsewhere->ensureHostProfile();
        HostBrandAssignment::create(['host_id' => $elsewhere->hostProfile->id, 'brand_id' => $other->id, 'status' => 'active']);

        $this->actingAs($this->admin)->postJson('/api/admin/ratings/apply-suggested', ['month_year' => '2026-10', 'brand_id' => $this->brand->id])
            ->assertOk()
            ->assertJsonPath('rated', 1);

        $this->assertDatabaseHas(HostRating::class, ['host_id' => $this->host->id, 'month_year' => '2026-10']);
        $this->assertDatabaseMissing(HostRating::class, ['host_id' => $elsewhere->hostProfile->id]);
    }

    public function test_rating_rows_list_each_hosts_active_brands(): void
    {
        $inactive = Brand::create(['name' => 'Brand Lama', 'target_hours_per_period' => 100, 'status' => 'inactive']);
        HostBrandAssignment::create(['host_id' => $this->host->id, 'brand_id' => $inactive->id, 'status' => 'active']);
        $banned = Brand::create(['name' => 'Brand C', 'target_hours_per_period' => 100]);
        HostBrandAssignment::create(['host_id' => $this->host->id, 'brand_id' => $banned->id, 'status' => 'banned']);

        $row = collect($this->actingAs($this->admin)->getJson('/api/admin/ratings?month=2026-10')->json('hosts'))
            ->firstWhere('host_id', $this->host->id);

        $this->assertSame([['id' => $this->brand->id, 'name' => 'Brand A']], $row['brands']);
    }

    public function test_suggestions_without_deductions_skip_hosts_whose_violations_took_something_off(): void
    {
        $this->violation(); // Telat, impact 0.2
        $clean = $this->newHost();

        $this->actingAs($this->admin)->postJson('/api/admin/ratings/apply-suggested', ['month_year' => '2026-10', 'without_deductions' => true])
            ->assertOk()
            ->assertJsonPath('rated', 1);

        $this->assertSame(5.0, HostRating::where('host_id', $clean->id)->value('rating'));
        $this->assertDatabaseMissing(HostRating::class, ['host_id' => $this->host->id]);
    }

    public function test_rating_review_shows_the_months_violations_and_recent_ratings(): void
    {
        $this->violation(['violation_type_id' => $this->type('Main HP saat live')->id, 'reason' => 'HP di meja']); // impact 0.5
        $this->violation(['occurred_on' => '2026-09-20']); // last month
        foreach (['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-11'] as $index => $month) {
            HostRating::create(['host_id' => $this->host->id, 'month_year' => $month, 'rating' => 3 + $index * 0.2, 'rated_by' => $this->admin->id]);
        }

        $response = $this->actingAs($this->admin)->getJson("/api/admin/ratings/hosts/{$this->host->id}?month=2026-10")->assertOk();

        $this->assertSame([[
            'id' => $response->json('violations.0.id'),
            'name' => 'Main HP saat live',
            'rating_impact' => 0.5,
            'points' => -10,
            'occurred_on' => '2026-10-05',
            'reason' => 'HP di meja',
        ]], $response->json('violations'));
        $this->assertSame(['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04'], array_column($response->json('ratings'), 'month_year'));
    }

    public function test_only_admins_see_a_hosts_rating_review(): void
    {
        $this->actingAs($this->operator)->getJson("/api/admin/ratings/hosts/{$this->host->id}")->assertForbidden();
    }

    public function test_only_admins_apply_the_suggested_ratings(): void
    {
        $this->actingAs($this->operator)->postJson('/api/admin/ratings/apply-suggested', ['month_year' => '2026-10'])->assertForbidden();

        $this->assertSame(0, HostRating::count());
    }

    public function test_applying_suggestions_needs_a_month(): void
    {
        $this->actingAs($this->admin)->postJson('/api/admin/ratings/apply-suggested', ['month_year' => 'Oktober'])
            ->assertJsonValidationErrors('month_year');
    }

    public function test_rating_must_be_within_the_scale(): void
    {
        $this->actingAs($this->admin)->putJson('/api/admin/ratings', [
            'host_id' => $this->host->id, 'month_year' => '2026-10', 'rating' => 6,
        ])->assertJsonValidationErrors('rating');
    }

    public function test_backup_applicants_rank_by_rating_first(): void
    {
        $sameBrand = $this->newHost();
        $otherBrandHost = User::factory()->create();
        $otherBrandHost->assignRole('host');
        $otherBrandHost->ensureHostProfile();
        $other = $otherBrandHost->hostProfile;

        HostRating::create(['host_id' => $sameBrand->id, 'month_year' => '2026-09', 'rating' => 3.5]);
        HostRating::create(['host_id' => $other->id, 'month_year' => '2026-09', 'rating' => 4.8]);

        $backup = $this->filledBackup(null);
        $this->actingAs($sameBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk();
        $this->actingAs($other->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk();

        $this->actingAs($this->admin)->getJson("/api/operator/backups/{$backup->id}/applicants")
            ->assertJsonPath('applicants.0.host_id', $other->id)
            ->assertJsonPath('applicants.0.rating', 4.8);
    }

    public function test_admin_manages_violation_types(): void
    {
        $id = $this->actingAs($this->admin)->postJson('/api/admin/violation-types', [
            'name' => 'Salah sebut harga', 'default_points' => 8, 'rating_impact' => 0.3,
        ])->assertCreated()->json('violation_type.id');

        $this->actingAs($this->admin)->putJson("/api/admin/violation-types/{$id}", ['is_active' => false])->assertOk();

        $this->actingAs($this->operator)->getJson('/api/operator/violation-types')
            ->assertJsonMissing(['name' => 'Salah sebut harga']);
    }

    /**
     * An open-or-filled backup for the main host's Tuesday slot, covered by `$cover` (null = open).
     */
    private function filledBackup(?HostProfile $cover, string $reason = 'permit', string $start = '2026-10-06 14:00', string $end = '2026-10-06 16:00'): BackupRequest
    {
        $slot = ScheduleSlot::create([
            'assignment_id' => $this->host->assignments()->firstOrFail()->id,
            'day_of_week' => 2,
            'start_time' => substr($start, 11, 5),
            'end_time' => substr($end, 11, 5),
            'effective_from' => '2026-09-01',
        ]);

        $backup = BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $this->brand->id, 'requesting_host_id' => $this->host->id,
            'backup_date' => substr($start, 0, 10), 'start_at' => $start, 'end_at' => $end,
            'reason_type' => $reason, 'status' => $cover ? 'filled' : 'open',
            'filled_by_host_id' => $cover?->id, 'auto_fill_at' => $start,
        ]);

        if ($cover) {
            $backup->applications()->create(['applicant_host_id' => $cover->id, 'status' => 'approved']);
        }

        return $backup;
    }
}
