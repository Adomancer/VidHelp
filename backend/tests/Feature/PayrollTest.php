<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\Brand;
use App\Models\CashAdvance;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\HostRateCategory;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\SalarySlip;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\PayrollService;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PayrollTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Brand $brand;

    /** Rate Rp 20.000/h (Magang) */
    private HostProfile $host;

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        HostRateCategory::where('name', 'Magang')->update(['rate_per_hour' => 20000]);
        HostRateCategory::where('name', 'Baru')->update(['rate_per_hour' => 25000]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();

        // Weekly cycle from Thu 1 Oct: 1-7, 8-14, ... Target 10 hours per period
        $this->brand = Brand::create([
            'name' => 'Brand A', 'target_hours_per_period' => 10, 'payment_cycle_days' => 7, 'payroll_start_date' => '2026-10-01',
        ]);
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

    /** An approved work session (attendance → report → session), placed in its period. */
    private function workSession(HostProfile $host, string $date, float $hours, ?Brand $brand = null): WorkSession
    {
        $brand ??= $this->brand;
        $start = CarbonImmutable::parse("{$date} 10:00");
        $end = $start->addMinutes((int) round($hours * 60));

        $attendance = Attendance::create([
            'host_id' => $host->id, 'brand_id' => $brand->id, 'session_date' => $date,
            'scheduled_start_at' => $start, 'scheduled_end_at' => $end, 'check_in_at' => $start, 'check_out_at' => $end,
            'report_due_at' => $start->addDay(),
        ]);
        $report = LiveReport::create([
            'attendance_id' => $attendance->id, 'host_id' => $host->id, 'brand_id' => $brand->id,
            'session_count' => 1, 'duration_hours' => $hours, 'status' => 'approved', 'submitted_at' => $end,
        ]);
        $session = WorkSession::create([
            'live_report_id' => $report->id, 'host_id' => $host->id, 'brand_id' => $brand->id, 'session_date' => $date,
            'start_at' => $start, 'end_at' => $end, 'duration_hours' => $hours, 'session_type' => 'regular',
        ]);
        app(PayrollService::class)->assign($session);

        return $session->fresh();
    }

    private function period(string $start): PaymentPeriod
    {
        return PaymentPeriod::where('brand_id', $this->brand->id)->whereDate('period_start', $start)->firstOrFail();
    }

    public function test_sessions_land_in_back_to_back_periods(): void
    {
        $first = $this->workSession($this->host, '2026-10-03', 2);
        $second = $this->workSession($this->host, '2026-10-09', 3);

        $this->assertSame($this->period('2026-10-01')->id, $first->payment_period_id);
        $this->assertSame('2026-10-14', $this->period('2026-10-08')->period_end->toDateString());
        $this->assertSame($this->period('2026-10-08')->id, $second->payment_period_id);
    }

    public function test_setting_a_payroll_start_date_picks_up_earlier_sessions(): void
    {
        $brandB = Brand::create(['name' => 'Brand B', 'target_hours_per_period' => 10, 'payment_cycle_days' => 14]);
        $session = $this->workSession($this->host, '2026-10-02', 2, $brandB);
        $this->assertNull($session->payment_period_id);

        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$brandB->id}", ['payroll_start_date' => '2026-10-01'])->assertOk();

        $this->assertNotNull($session->fresh()->payment_period_id);
    }

    public function test_payroll_start_cannot_move_once_periods_exist(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);

        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$this->brand->id}", ['payroll_start_date' => '2026-10-02'])
            ->assertJsonValidationErrors('payroll_start_date');
        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$this->brand->id}", ['payment_cycle_days' => 14])
            ->assertJsonValidationErrors('payroll_start_date');
        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$this->brand->id}", ['target_hours_per_period' => 12])->assertOk();
    }

    public function test_approved_live_report_is_placed_in_its_period(): void
    {
        $slot = ScheduleSlot::create([
            'assignment_id' => $this->host->assignments()->first()->id,
            'day_of_week' => 1, 'start_time' => '10:00', 'end_time' => '12:00', 'effective_from' => '2026-09-01',
        ]);
        $id = $this->actingAs($this->host->user)->postJson('/api/host/live/check-in', ['slot_id' => $slot->id, 'date' => '2026-10-05'])->json('attendance.id');
        $this->travelTo(CarbonImmutable::parse('2026-10-05 12:00'));
        $this->actingAs($this->host->user)->postJson("/api/host/live/{$id}/check-out")->assertOk();
        $this->actingAs($this->host->user)->postJson("/api/host/live/{$id}/report", ['session_count' => 1, 'duration_hours' => 2])
            ->assertJsonPath('report.status', 'approved');

        $this->assertSame($this->period('2026-10-01')->id, WorkSession::firstOrFail()->payment_period_id);
    }

    public function test_live_totals_use_hours_times_rate_plus_adjustments(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $this->workSession($this->host, '2026-10-03', 1.5);
        $period = $this->period('2026-10-01');

        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/adjustments", [
            'host_id' => $this->host->id, 'sessions_added' => 0, 'hours_added' => 0.5, 'notes' => 'Live cut by a power outage',
        ])->assertCreated();

        $this->actingAs($this->admin)->getJson("/api/admin/payroll/periods/{$period->id}")
            ->assertJsonPath('hosts.0.hours', 4)
            ->assertJsonPath('hosts.0.session_count', 2)
            ->assertJsonPath('hosts.0.amount', 80000)
            ->assertJsonPath('hosts.0.estimate', true)
            ->assertJsonPath('summary.worked_hours', 4);
    }

    public function test_payment_can_only_be_requested_after_the_period_ends(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $period = $this->period('2026-10-01');

        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/request")->assertJsonValidationErrors('period');

        $this->travelTo(CarbonImmutable::parse('2026-10-08 00:10'));
        $this->artisan('payroll:roll-periods')->assertSuccessful();
        $this->assertSame('waiting_payment', $period->fresh()->status);

        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/request")->assertOk();
    }

    public function test_request_locks_pay_at_todays_rate_and_carries_extra_hours(): void
    {
        $other = $this->newHost();
        $other->update(['rate_category_id' => HostRateCategory::where('name', 'Baru')->value('id'), 'rate_category_overridden' => true]);
        $this->workSession($this->host, '2026-10-02', 7);
        $this->workSession($other, '2026-10-03', 5);
        $period = $this->period('2026-10-01');

        $this->travelTo(CarbonImmutable::parse('2026-10-08 09:00'));
        $this->artisan('payroll:roll-periods');
        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/request")->assertOk();

        // A later rate change does not touch the locked period
        HostRateCategory::where('name', 'Magang')->update(['rate_per_hour' => 99999]);

        $detail = $this->actingAs($this->admin)->getJson("/api/admin/payroll/periods/{$period->id}")
            ->assertJsonPath('period.status', 'requested')
            ->assertJsonPath('summary.worked_hours', 12)
            ->assertJsonPath('summary.achieved_hours', 10) // capped at the target
            ->assertJsonPath('summary.carried_out_hours', 2)
            ->assertJsonPath('summary.total_amount', 265000) // 7 × 20.000 + 5 × 25.000
            ->json('hosts');
        $this->assertFalse($detail[0]['estimate']);

        $this->assertSame(2.0, $this->period('2026-10-08')->carried_in_hours);
    }

    public function test_locked_period_takes_no_changes_and_late_sessions_move_on(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $period = $this->period('2026-10-01');
        $this->travelTo(CarbonImmutable::parse('2026-10-08 09:00'));
        $this->artisan('payroll:roll-periods');
        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/request")->assertOk();

        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/adjustments", [
            'host_id' => $this->host->id, 'sessions_added' => 1, 'hours_added' => 1, 'notes' => 'Too late',
        ])->assertJsonValidationErrors('period');

        // A report for 6 Oct approved only now goes to the next period
        $late = $this->workSession($this->host, '2026-10-06', 1);
        $this->assertSame($this->period('2026-10-08')->id, $late->payment_period_id);
    }

    public function test_paid_period_creates_slips_and_deducts_kasbon(): void
    {
        $this->actingAs($this->admin)->postJson('/api/admin/cash-advances', [
            'host_id' => $this->host->id, 'type' => 'loan', 'total_amount' => 30001, 'installment_count' => 2,
        ])->assertCreated()->assertJsonPath('advance.installments.0.amount', 15000)->assertJsonPath('advance.installments.1.amount', 15001);

        $this->workSession($this->host, '2026-10-02', 2); // 40.000
        $period = $this->period('2026-10-01');
        $this->travelTo(CarbonImmutable::parse('2026-10-08 09:00'));
        $this->artisan('payroll:roll-periods');
        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/request")->assertOk();
        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/paid")->assertOk();

        $slip = SalarySlip::firstOrFail();
        $this->assertSame(40000.0, $slip->gross_amount);
        $this->assertSame(15000.0, $slip->advance_deduction);
        $this->assertSame(25000.0, $slip->net_amount);
        $this->assertSame('in_progress', CashAdvance::firstOrFail()->status);

        $this->actingAs($this->admin)->getJson("/api/admin/payroll/slips/{$slip->id}")
            ->assertJsonPath('slip.deductions.0.seq', 1)
            ->assertJsonPath('slip.deductions.0.installment_count', 2);

        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/paid")->assertJsonValidationErrors('period');
    }

    public function test_installment_bigger_than_the_slip_waits_for_the_next_one(): void
    {
        $this->actingAs($this->admin)->postJson('/api/admin/cash-advances', [
            'host_id' => $this->host->id, 'type' => 'early_payment', 'total_amount' => 50000, 'installment_count' => 1,
        ])->assertCreated();

        $this->workSession($this->host, '2026-10-02', 2); // 40.000 < 50.000
        $period = $this->period('2026-10-01');
        $this->travelTo(CarbonImmutable::parse('2026-10-08 09:00'));
        $this->artisan('payroll:roll-periods');
        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/request");
        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/paid")->assertOk();

        $this->assertSame(40000.0, SalarySlip::firstOrFail()->net_amount);
        $this->assertSame('unpaid', CashAdvance::firstOrFail()->status);
    }

    public function test_kasbon_with_deductions_cannot_be_removed(): void
    {
        $id = $this->actingAs($this->admin)->postJson('/api/admin/cash-advances', [
            'host_id' => $this->host->id, 'type' => 'loan', 'total_amount' => 10000, 'installment_count' => 1,
        ])->json('advance.id');

        $this->actingAs($this->admin)->deleteJson("/api/admin/cash-advances/{$id}")->assertOk();
        $this->assertSame(0, CashAdvance::count());
    }

    public function test_brand_report_csv_lists_sessions_and_totals(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $period = $this->period('2026-10-01');

        $csv = $this->actingAs($this->admin)->get("/api/admin/payroll/periods/{$period->id}/export")
            ->assertOk()
            ->assertHeader('content-type', 'text/csv; charset=UTF-8')
            ->getContent();

        $this->assertStringContainsString($this->host->user->name, $csv);
        $this->assertStringContainsString('Billable hours (target 10)', $csv);
    }

    public function test_host_sees_estimate_slips_and_only_their_own_slip(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $this->actingAs($this->host->user)->getJson('/api/host/pay')
            ->assertJsonPath('current.0.hours', 2)
            ->assertJsonPath('current.0.estimate', 40000);

        $period = $this->period('2026-10-01');
        $this->travelTo(CarbonImmutable::parse('2026-10-08 09:00'));
        $this->artisan('payroll:roll-periods');
        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/request");
        $this->actingAs($this->admin)->postJson("/api/admin/payroll/periods/{$period->id}/paid");
        $slip = SalarySlip::firstOrFail();

        $this->actingAs($this->host->user)->getJson('/api/host/pay')->assertJsonPath('slips.0.net_amount', 40000);
        $this->actingAs($this->host->user)->getJson("/api/host/pay/slips/{$slip->id}")->assertOk()->assertJsonPath('slip.hours', 2);
        $this->actingAs($this->newHost()->user)->getJson("/api/host/pay/slips/{$slip->id}")->assertForbidden();
    }

    public function test_operator_cannot_open_payroll(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->getJson('/api/admin/payroll/periods')->assertForbidden();
    }
}
