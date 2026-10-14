<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\LiveReport;
use App\Models\PointBalance;
use App\Models\PointLog;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\ViolationType;
use App\Models\WorkSession;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Database\Seeders\ViolationTypeSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AttendanceTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private HostProfile $host;

    /** Tuesday 14:00-16:00 on Brand A */
    private ScheduleSlot $slot;

    private const TUESDAY = '2026-10-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 13:30'));
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();

        $this->host = $this->newHost();
        $brand = Brand::create(['name' => 'Brand A', 'target_hours_per_period' => 100, 'payment_cycle_days' => 14]);
        $assignment = HostBrandAssignment::create(['host_id' => $this->host->id, 'brand_id' => $brand->id, 'status' => 'active']);
        $this->slot = ScheduleSlot::create([
            'assignment_id' => $assignment->id, 'day_of_week' => 2,
            'start_time' => '14:00', 'end_time' => '16:00', 'effective_from' => '2026-09-01',
        ]);
    }

    private function newHost(): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();

        return $user->hostProfile;
    }

    private function checkIn(?HostProfile $as = null, array $extra = [])
    {
        return $this->actingAs(($as ?? $this->host)->user)->postJson('/api/host/live/check-in', $extra + [
            'slot_id' => $this->slot->id,
            'date' => self::TUESDAY,
        ]);
    }

    /** Check in at 14:00, out at `$outAt`. */
    private function attended(string $outAt = '16:00'): Attendance
    {
        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 14:00'));
        $attendance = Attendance::findOrFail($this->checkIn()->assertCreated()->json('attendance.id'));
        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' '.$outAt));
        $this->actingAs($this->host->user)->postJson("/api/host/live/{$attendance->id}/check-out")->assertOk();

        return $attendance->fresh();
    }

    private function report(Attendance $attendance, float $hours = 2, array $extra = [])
    {
        return $this->actingAs($this->host->user)->postJson("/api/host/live/{$attendance->id}/report", $extra + [
            'session_count' => 1,
            'duration_hours' => $hours,
            'metrics' => ['gmv' => 12500000, 'orders' => 84, 'viewers' => 3100],
        ]);
    }

    public function test_today_lists_my_session(): void
    {
        $this->actingAs($this->host->user)->getJson('/api/host/live')
            ->assertOk()
            ->assertJsonPath('sessions.0.slot_id', $this->slot->id)
            ->assertJsonPath('sessions.0.role', 'own')
            ->assertJsonPath('sessions.0.attendance', null)
            ->assertJsonPath('metrics', ['gmv', 'orders', 'viewers']);
    }

    public function test_check_in_window(): void
    {
        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 12:59'));
        $this->checkIn()->assertJsonValidationErrors('session');

        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 13:05'));
        $this->checkIn()->assertCreated()->assertJsonPath('attendance.report_due_at', fn ($due) => str_starts_with($due, '2026-10-07'));
        $this->checkIn()->assertJsonValidationErrors('session'); // twice
    }

    public function test_check_in_up_to_ten_minutes_after_the_start_is_on_time(): void
    {
        $this->seed(ViolationTypeSeeder::class);

        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 14:10'));
        $this->checkIn()->assertCreated()->assertJsonPath('attendance.late_minutes', 0);

        $this->assertSame(0, PointLog::count());
    }

    public function test_late_check_in_deducts_the_telat_violation(): void
    {
        $this->seed(ViolationTypeSeeder::class);

        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 14:11'));
        $this->checkIn()
            ->assertCreated()
            ->assertJsonPath('attendance.late_minutes', 11)
            ->assertJsonPath('message', fn ($message) => str_contains($message, 'telat 11 menit'));

        $log = PointLog::sole();
        $this->assertSame('late_check_in', $log->source);
        $this->assertSame(-5, $log->points_change);
        $this->assertSame(self::TUESDAY, $log->occurred_on->toDateString());
        $this->assertSame(95, PointBalance::where('host_id', $this->host->id)->value('current_points'));
    }

    public function test_late_check_in_is_not_penalized_when_the_admin_turned_telat_off(): void
    {
        $this->seed(ViolationTypeSeeder::class);
        ViolationType::where('code', ViolationType::LATE_CHECK_IN)->update(['is_active' => false]);

        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 14:30'));
        $this->checkIn()->assertCreated()->assertJsonPath('attendance.late_minutes', 30);

        $this->assertSame(0, PointLog::count());
    }

    public function test_cannot_check_in_after_the_session_ended(): void
    {
        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 16:00'));
        $this->checkIn()->assertJsonValidationErrors('session');
    }

    public function test_matching_report_is_auto_approved_into_a_work_session(): void
    {
        $attendance = $this->attended();

        $this->report($attendance, 2)
            ->assertOk()
            ->assertJsonPath('report.status', 'approved')
            ->assertJsonPath('report.metrics.gmv', 12500000);

        $session = WorkSession::firstOrFail();
        $this->assertSame(2.0, $session->duration_hours);
        $this->assertSame('regular', $session->session_type);
        $this->assertSame(self::TUESDAY, $session->session_date->toDateString());
    }

    public function test_slightly_short_report_is_still_approved(): void
    {
        $this->report($this->attended('15:50'), 1.8)->assertJsonPath('report.status', 'approved');
    }

    public function test_short_session_in_minutes_is_approved(): void
    {
        $this->slot->update(['start_time' => '14:00', 'end_time' => '14:20']); // 20 minutes = 0.33 h

        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 14:00'));
        $attendance = Attendance::findOrFail($this->checkIn()->assertCreated()->json('attendance.id'));
        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 14:20'));
        $this->actingAs($this->host->user)->postJson("/api/host/live/{$attendance->id}/check-out")->assertOk();

        $this->report($attendance, 20 / 60)
            ->assertJsonPath('report.status', 'approved')
            ->assertJsonPath('report.duration_hours', 0.33);
    }

    public function test_report_over_schedule_is_flagged(): void
    {
        $this->report($this->attended(), 2.5)
            ->assertJsonPath('report.status', 'flagged')
            ->assertJsonPath('report.flag_reasons', ['more_than_scheduled', 'more_than_attended']);

        $this->assertSame(0, WorkSession::count());
    }

    public function test_report_longer_than_attended_is_flagged(): void
    {
        $this->report($this->attended('15:00'), 2)
            ->assertJsonPath('report.flag_reasons', ['more_than_attended']);
    }

    public function test_report_without_check_out_is_flagged(): void
    {
        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 14:00'));
        $attendance = Attendance::findOrFail($this->checkIn()->json('attendance.id'));

        $this->report($attendance)->assertJsonPath('report.flag_reasons', ['no_check_out']);
    }

    public function test_late_report_stays_flagged_late_after_resubmitting(): void
    {
        $attendance = $this->attended();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 14:30'));

        $this->report($attendance)->assertJsonPath('report.flag_reasons', ['late_report']);
        $this->report($attendance, 1.9)->assertJsonPath('report.flag_reasons', ['late_report']);
    }

    public function test_operator_approves_flagged_report_with_corrected_hours(): void
    {
        $report = LiveReport::findOrFail($this->report($this->attended(), 3)->json('report.id'));

        $this->actingAs($this->admin)->getJson('/api/operator/reports?status=flagged')
            ->assertJsonPath('reports.0.scheduled_hours', 2)
            ->assertJsonPath('reports.0.attended_hours', 2);

        $this->actingAs($this->admin)->postJson("/api/operator/reports/{$report->id}/approve", [
            'duration_hours' => 2,
            'review_note' => 'Capped to schedule',
        ])->assertOk();

        $this->assertSame('approved', $report->fresh()->status);
        $this->assertSame($this->admin->id, $report->fresh()->reviewed_by);
        $this->assertSame(2.0, WorkSession::firstOrFail()->duration_hours);
    }

    public function test_rejected_report_pays_nothing_and_is_final(): void
    {
        $attendance = $this->attended();
        $report = LiveReport::findOrFail($this->report($attendance, 3)->json('report.id'));

        $this->actingAs($this->admin)->postJson("/api/operator/reports/{$report->id}/reject", ['review_note' => 'No live found'])->assertOk();

        $this->assertSame(0, WorkSession::count());
        $this->report($attendance, 2)->assertJsonValidationErrors('report');
    }

    public function test_backup_cover_checks_in_and_is_paid_as_backup(): void
    {
        $cover = $this->newHost();
        $backup = BackupRequest::create([
            'slot_id' => $this->slot->id, 'brand_id' => $this->slot->assignment->brand_id,
            'requesting_host_id' => $this->host->id, 'backup_date' => self::TUESDAY,
            'start_at' => self::TUESDAY.' 14:00', 'end_at' => self::TUESDAY.' 16:00',
            'reason_type' => 'sick', 'status' => 'filled', 'filled_by_host_id' => $cover->id,
            'auto_fill_at' => self::TUESDAY.' 13:30',
        ]);

        // The requester is off
        $this->actingAs($this->host->user)->getJson('/api/host/live')->assertJsonPath('sessions.0.role', 'off');
        $this->checkIn()->assertJsonValidationErrors('session');

        // The cover sees it and checks in
        $this->actingAs($cover->user)->getJson('/api/host/live')
            ->assertJsonPath('sessions.0.role', 'cover')
            ->assertJsonPath('sessions.0.backup_request_id', $backup->id);

        $id = $this->checkIn($cover, ['backup_request_id' => $backup->id])->assertCreated()->json('attendance.id');
        $this->travelTo(CarbonImmutable::parse(self::TUESDAY.' 16:00'));
        $this->actingAs($cover->user)->postJson("/api/host/live/{$id}/check-out")->assertOk();
        $this->actingAs($cover->user)->postJson("/api/host/live/{$id}/report", ['session_count' => 1, 'duration_hours' => 2])
            ->assertJsonPath('report.status', 'approved');

        $session = WorkSession::firstOrFail();
        $this->assertSame('backup', $session->session_type);
        $this->assertSame($cover->id, $session->host_id);
    }

    public function test_overdue_reports_show_as_missing(): void
    {
        $this->attended();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 14:01'));

        $this->actingAs($this->admin)->getJson('/api/operator/reports?status=missing')->assertJsonCount(1, 'attendances');
    }

    public function test_unknown_metrics_are_dropped(): void
    {
        $this->report($this->attended(), 2, ['metrics' => ['gmv' => 100, 'hack' => 'x']])
            ->assertJsonPath('report.metrics', ['gmv' => 100]);
    }

    public function test_cannot_touch_someone_elses_attendance(): void
    {
        $attendance = $this->attended();
        $other = $this->newHost();

        $this->actingAs($other->user)->postJson("/api/host/live/{$attendance->id}/report", ['session_count' => 1, 'duration_hours' => 2])
            ->assertForbidden();
    }
}
