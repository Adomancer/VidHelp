<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\HostRateCategory;
use App\Models\LiveReport;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\PayrollService;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Brand $brand;

    private const TUESDAY = '2026-10-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 15:00'));
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        HostRateCategory::query()->update(['rate_per_hour' => 20000]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();

        // Weekly periods from Thu 1 Oct: today is in 1-7 Oct
        $this->brand = Brand::create([
            'name' => 'Glow', 'target_hours_per_period' => 10, 'payroll_start_date' => '2026-10-01',
        ]);
    }

    /** A host with a Tuesday slot on the brand. */
    private function hostWithSlot(string $start, string $end): array
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();
        $assignment = HostBrandAssignment::create(['host_id' => $user->hostProfile->id, 'brand_id' => $this->brand->id, 'status' => 'active']);
        $slot = ScheduleSlot::create([
            'assignment_id' => $assignment->id, 'day_of_week' => 2,
            'start_time' => $start, 'end_time' => $end, 'effective_from' => '2026-09-01',
        ]);

        return [$user->hostProfile, $slot];
    }

    private function attend(HostProfile $host, ScheduleSlot $slot, string $in, ?string $out = null): Attendance
    {
        [$start, $end] = $slot->occurrenceOn(CarbonImmutable::parse(self::TUESDAY));

        return Attendance::create([
            'host_id' => $host->id, 'slot_id' => $slot->id, 'brand_id' => $this->brand->id, 'session_date' => self::TUESDAY,
            'scheduled_start_at' => $start, 'scheduled_end_at' => $end,
            'check_in_at' => self::TUESDAY." {$in}", 'check_out_at' => $out ? self::TUESDAY." {$out}" : null,
            'report_due_at' => $start->addDay(),
        ]);
    }

    /** An approved report with GMV and its paid work session. */
    private function approvedSession(Attendance $attendance, float $hours, float $gmv): void
    {
        $report = LiveReport::create([
            'attendance_id' => $attendance->id, 'host_id' => $attendance->host_id, 'brand_id' => $this->brand->id,
            'session_count' => 1, 'duration_hours' => $hours, 'metrics' => ['gmv' => $gmv], 'status' => 'approved',
            'submitted_at' => $attendance->check_out_at,
        ]);
        $session = WorkSession::create([
            'live_report_id' => $report->id, 'host_id' => $attendance->host_id, 'brand_id' => $this->brand->id,
            'session_date' => self::TUESDAY, 'start_at' => $attendance->scheduled_start_at, 'end_at' => $attendance->scheduled_end_at,
            'duration_hours' => $hours, 'session_type' => 'regular',
        ]);
        app(PayrollService::class)->assign($session);
    }

    public function test_today_shows_each_session_with_its_check_in_state(): void
    {
        [$done, $doneSlot] = $this->hostWithSlot('08:00', '10:00');
        [, $missedSlot] = $this->hostWithSlot('10:00', '12:00');
        [$live, $liveSlot] = $this->hostWithSlot('14:00', '16:00');
        [, $lateSlot] = $this->hostWithSlot('14:30', '17:00');
        [, $upcomingSlot] = $this->hostWithSlot('19:00', '21:00');
        $this->attend($done, $doneSlot, '07:55', '10:00');
        $this->attend($live, $liveSlot, '13:58');

        $today = $this->actingAs($this->admin)->getJson('/api/admin/dashboard')->assertOk()->json('today');

        $this->assertSame(['done', 'missed', 'live', 'late', 'upcoming'], array_column($today['sessions'], 'state'));
        $this->assertSame(['done' => 1, 'missed' => 1, 'live' => 1, 'late' => 1, 'upcoming' => 1], $today['counts']);
        $this->assertSame('Glow', $today['sessions'][0]['brand']['name']);
    }

    public function test_brand_progress_hours_gmv_and_pay_this_period(): void
    {
        [$host, $slot] = $this->hostWithSlot('08:00', '10:00');
        $this->approvedSession($this->attend($host, $slot, '08:00', '10:00'), 2, 1500000);

        $response = $this->actingAs($this->admin)->getJson('/api/admin/dashboard')->assertOk();

        $brand = $response->json('brands.0');
        $this->assertSame('2026-10-01', $brand['period']['start']);
        $this->assertEquals(8, $brand['period']['hours_left']); // 2 of 10 worked
        $this->assertEquals(2, $brand['worked_hours']);
        $this->assertEquals(10, $brand['target_hours']);
        $this->assertEquals(1500000, $brand['gmv']);
        $this->assertEquals(40000, $brand['total_amount']);

        $days = $response->json('hours_by_day');
        $this->assertCount(14, $days);
        $this->assertEquals(['date' => self::TUESDAY, 'hours' => 2], end($days));
    }

    public function test_attention_counts_what_is_waiting_on_staff(): void
    {
        [$host, $slot] = $this->hostWithSlot('08:00', '10:00');
        User::factory()->create(['status' => 'pending']);
        BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $this->brand->id, 'requesting_host_id' => $host->id, 'created_by' => $host->user_id,
            'backup_date' => '2026-10-13', 'start_at' => '2026-10-13 08:00', 'end_at' => '2026-10-13 10:00',
            'reason_type' => 'permit', 'status' => 'pending',
            'auto_open_at' => '2026-10-06 15:30', 'auto_fill_at' => '2026-10-13 07:30',
        ]);
        BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $this->brand->id, 'requesting_host_id' => $host->id, 'created_by' => $host->user_id,
            'backup_date' => '2026-10-08', 'start_at' => '2026-10-08 08:00', 'end_at' => '2026-10-08 10:00',
            'reason_type' => 'permit', 'status' => 'open',
            'auto_open_at' => '2026-10-06 15:30', 'auto_fill_at' => '2026-10-08 07:30',
        ]);
        $this->travelTo(CarbonImmutable::parse('2026-10-07 15:00')); // yesterday's session never got a report
        $this->attend($host, $slot, '08:00', '10:00');

        $this->actingAs($this->admin)->getJson('/api/admin/dashboard')
            ->assertOk()
            ->assertJsonPath('attention.pending_signups', 1)
            ->assertJsonPath('attention.backups_pending', 1)
            ->assertJsonPath('attention.reports_missing', 1)
            ->assertJsonPath('attention.backups_uncovered_soon', 1) // no cover yet, starts in 17 hours
            ->assertJsonPath('people.active_hosts', 1);
    }

    public function test_only_admins_see_the_admin_dashboard(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->getJson('/api/admin/dashboard')->assertForbidden();
    }
}
