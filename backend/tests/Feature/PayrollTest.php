<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Attendance;
use App\Models\BackupRequest;
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
use App\Services\BackupService;
use App\Services\PayrollService;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PayrollTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    /** Runs payroll and kasbon (admins may only look) */
    private User $finance;

    private Brand $brand;

    /** Rate Rp 20.000/h (Di bawah 1 tahun) */
    private HostProfile $host;

    /** The host's Sunday 19:00-22:00 slot: 3 h a week × 52/12 × Rp 20.000 = Rp 260.000 a month (the kasbon limit) */
    private ScheduleSlot $slot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        HostRateCategory::where('name', 'Di bawah 1 tahun')->update(['rate_per_hour' => 20000]);
        HostRateCategory::where('name', 'Di atas 1 tahun')->update(['rate_per_hour' => 25000]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
        $this->finance = User::factory()->create();
        $this->finance->assignRole('finance');

        // Periods from Thu 1 Oct, each running until 10 hours are reached
        $this->brand = Brand::create([
            'name' => 'Brand A', 'target_hours_per_period' => 10, 'payroll_start_date' => '2026-10-01',
        ]);
        $this->host = $this->newHost();
        $this->slot = ScheduleSlot::create([
            'assignment_id' => $this->host->assignments()->first()->id,
            'day_of_week' => 7, 'start_time' => '19:00', 'end_time' => '22:00', 'effective_from' => '2026-09-01',
        ]);
    }

    private function newHost(): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();
        HostBrandAssignment::create(['host_id' => $user->hostProfile->id, 'brand_id' => $this->brand->id, 'status' => 'active']);

        return $user->hostProfile;
    }

    /** A live report (with its attendance) for a 10:00 session. */
    private function liveReport(HostProfile $host, string $date, float $hours, string $status, ?Brand $brand = null, ?BackupRequest $backup = null): LiveReport
    {
        $brand ??= $this->brand;
        $start = CarbonImmutable::parse("{$date} 10:00");
        $end = $start->addMinutes((int) round($hours * 60));

        $attendance = Attendance::create([
            'host_id' => $host->id, 'brand_id' => $brand->id, 'session_date' => $date, 'backup_request_id' => $backup?->id,
            'scheduled_start_at' => $start, 'scheduled_end_at' => $end, 'check_in_at' => $start, 'check_out_at' => $end,
            'report_due_at' => $start->addDay(),
        ]);

        return LiveReport::create([
            'attendance_id' => $attendance->id, 'host_id' => $host->id, 'brand_id' => $brand->id,
            'session_count' => 1, 'duration_hours' => $hours, 'status' => $status, 'submitted_at' => $end,
        ]);
    }

    /** An approved work session (attendance → report → session), placed in its period. */
    private function workSession(HostProfile $host, string $date, float $hours, ?Brand $brand = null, ?BackupRequest $backup = null): WorkSession
    {
        $report = $this->liveReport($host, $date, $hours, 'approved', $brand, $backup);
        $attendance = $report->attendance;

        $session = WorkSession::create([
            'live_report_id' => $report->id, 'host_id' => $host->id, 'brand_id' => $report->brand_id, 'session_date' => $date,
            'start_at' => $attendance->check_in_at, 'end_at' => $attendance->check_out_at, 'duration_hours' => $hours,
            'session_type' => $backup ? 'backup' : 'regular',
        ]);
        app(PayrollService::class)->assign($session);

        return $session->fresh();
    }

    /** The host's 10:00-12:00 slot on $date, filled by $cover. */
    private function backup(string $date, string $reason, HostProfile $cover): BackupRequest
    {
        return BackupRequest::create([
            'slot_id' => $this->slot->id, 'brand_id' => $this->brand->id, 'requesting_host_id' => $this->host->id,
            'backup_date' => $date, 'start_at' => "{$date} 10:00", 'end_at' => "{$date} 12:00",
            'reason_type' => $reason, 'status' => 'filled', 'filled_by_host_id' => $cover->id, 'auto_fill_at' => "{$date} 09:30",
        ]);
    }

    /** On 8 Oct finance closes the first period before its target, so it waits for payment. */
    private function endFirstPeriod(): PaymentPeriod
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-08 09:00'));
        $period = $this->period('2026-10-01');
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/close")->assertOk();

        return $period->fresh();
    }

    /** The host as the brand's leader (its PIC). */
    private function makeLeader(HostProfile $host): void
    {
        $host->assignments()->where('brand_id', $this->brand->id)->update(['is_leader' => true]);
    }

    private function recordAdvance(int $amount, int $installments): string
    {
        return $this->actingAs($this->finance)->postJson('/api/finance/cash-advances', [
            'host_id' => $this->host->id, 'type' => 'loan', 'total_amount' => $amount, 'installment_count' => $installments,
        ])->assertCreated()->json('advance.id');
    }

    private function period(string $start): PaymentPeriod
    {
        return PaymentPeriod::where('brand_id', $this->brand->id)->whereDate('period_start', $start)->firstOrFail();
    }

    public function test_hosts_brands_and_users_with_pay_history_cannot_be_deleted(): void
    {
        $this->workSession($this->host, '2026-10-04', 3);

        foreach ([$this->host, $this->brand, $this->host->user] as $record) {
            try {
                DB::transaction(fn () => $record instanceof User ? $record->forceDelete() : $record->delete());
                $this->fail(class_basename($record).' with pay history was deleted.');
            } catch (QueryException) {
                // refused by the database
            }
        }

        $this->assertSame(1, WorkSession::where('host_id', $this->host->id)->count());
        $this->assertSame(1, PaymentPeriod::where('brand_id', $this->brand->id)->count());
    }

    public function test_period_runs_until_the_target_then_the_next_starts(): void
    {
        $this->makeLeader($this->host);
        $this->workSession($this->host, '2026-10-02', 4);
        $this->workSession($this->host, '2026-10-03', 4);
        $first = $this->period('2026-10-01');
        $this->assertSame('in_progress', $first->status);
        $this->assertNull($first->period_end);

        // 11 of 10 hours: the period closes on the day of its last session
        $this->workSession($this->host, '2026-10-04', 3);
        $first->refresh();
        $this->assertSame('waiting_payment', $first->status);
        $this->assertSame('2026-10-04', $first->period_end->toDateString());
        $this->assertNull($first->closed_by);
        $this->assertDatabaseHas(AppNotification::class, ['user_id' => $this->host->user_id, 'type' => 'period_ready']);

        $next = $this->period('2026-10-05');
        $this->assertSame('in_progress', $next->status);
        $this->assertSame($next->id, $this->workSession($this->host, '2026-10-06', 2)->payment_period_id);

        // A report from inside the closed period approved late still belongs to it
        $this->assertSame($first->id, $this->workSession($this->host, '2026-10-03', 1)->payment_period_id);
    }

    public function test_a_period_reaching_its_target_from_two_places_closes_once(): void
    {
        $this->makeLeader($this->host);
        $this->workSession($this->host, '2026-10-02', 4);
        $stale = $this->period('2026-10-01'); // as a second approval read it, still running
        $this->workSession($this->host, '2026-10-03', 7); // the first closes it

        $this->assertFalse(app(PayrollService::class)->closeIfTargetReached($stale));

        $this->assertSame(1, AppNotification::where('user_id', $this->host->user_id)->where('type', 'period_ready')->count());
        $this->assertSame(2, PaymentPeriod::where('brand_id', $this->brand->id)->count());
        $this->assertSame($this->period('2026-10-04')->id, app(PayrollService::class)->openPeriod($this->brand)->id);
    }

    public function test_period_list_takes_the_same_number_of_queries_however_many_paid_periods(): void
    {
        $queries = function () {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->actingAs($this->finance)->getJson('/api/finance/payroll/periods')->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };

        $this->lockedPay($this->brandPeriod('Kopi', 'paid', ['period_end' => '2026-09-20']), '2026-09-22 09:00', 200000, '2026-09-25 09:00');
        $queries();
        $before = $queries();
        foreach (['Teh', 'Susu', 'Roti'] as $name) {
            $this->lockedPay($this->brandPeriod($name, 'paid', ['period_end' => '2026-09-20']), '2026-09-22 09:00', 100000, '2026-09-25 09:00');
        }

        $this->assertSame($before, $queries());
        $periods = collect($this->actingAs($this->finance)->getJson('/api/finance/payroll/periods?status=paid')->json('data'))->keyBy('brand.name');
        $this->assertEquals(200000, $periods['Kopi']['total_amount']);
        $this->assertSame(1, $periods['Kopi']['hosts']);
    }

    public function test_setting_a_payroll_start_date_picks_up_earlier_sessions(): void
    {
        $brandB = Brand::create(['name' => 'Brand B', 'target_hours_per_period' => 10]);
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

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/adjustments", [
            'host_id' => $this->host->id, 'sessions_added' => 0, 'hours_added' => 0.5, 'notes' => 'Live cut by a power outage',
        ])->assertCreated();

        $this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$period->id}")
            ->assertJsonPath('hosts.0.hours', 4)
            ->assertJsonPath('hosts.0.session_count', 2)
            ->assertJsonPath('hosts.0.amount', 80000)
            ->assertJsonPath('hosts.0.estimate', true)
            ->assertJsonPath('summary.worked_hours', 4);
    }

    public function test_admin_sees_a_period_but_only_finance_runs_it(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $period = $this->period('2026-10-01');

        $this->actingAs($this->admin)->getJson("/api/finance/payroll/periods/{$period->id}")->assertOk();
        $this->actingAs($this->admin)->postJson("/api/finance/payroll/periods/{$period->id}/adjustments", ['hours' => 1])->assertForbidden();
        $this->actingAs($this->admin)->postJson("/api/finance/payroll/periods/{$period->id}/close")->assertForbidden();
        $this->assertSame('in_progress', $period->fresh()->status);

        $period = $this->endFirstPeriod(); // by finance
        $this->actingAs($this->admin)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertForbidden();
        $this->assertSame('waiting_payment', $period->fresh()->status);

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();
        $this->actingAs($this->admin)->postJson("/api/finance/payroll/periods/{$period->id}/paid")->assertForbidden();
        $this->actingAs($this->admin)->postJson("/api/finance/payroll/periods/{$period->id}/cancel-request", ['reason' => 'x'])->assertForbidden();
    }

    public function test_leader_requests_payment_only_once_the_target_is_reached(): void
    {
        $this->makeLeader($this->host);
        $finance = User::factory()->create();
        $finance->assignRole('finance');
        $this->workSession($this->host, '2026-10-02', 6);
        $period = $this->period('2026-10-01');

        $this->actingAs($this->host->user)->postJson("/api/host/pay/periods/{$period->id}/request")
            ->assertJsonValidationErrors('period')
            ->assertJsonPath('errors.period.0', fn ($message) => str_contains($message, 'Target 10 jam belum tercapai (baru 6 jam)'));

        $this->workSession($this->host, '2026-10-03', 4);
        $this->actingAs($this->host->user)->getJson('/api/host/pay')
            ->assertJsonPath('brand_periods.0.id', $this->period('2026-10-04')->id) // the new running one first
            ->assertJsonPath('brand_periods.1.status', 'waiting_payment')
            ->assertJsonPath('brand_periods.1.progress_hours', 10);

        // Only the brand's leader may request
        $this->actingAs($this->newHost()->user)->postJson("/api/host/pay/periods/{$period->id}/request")->assertForbidden();

        $this->actingAs($this->host->user)->postJson("/api/host/pay/periods/{$period->id}/request")->assertOk();
        $this->assertSame('requested', $period->fresh()->status);
        $this->assertSame($this->host->user_id, $period->paymentRequest()->firstOrFail()->requested_by);
        $this->assertDatabaseHas(AppNotification::class, ['user_id' => $finance->id, 'type' => 'payment_requested']);

        $this->actingAs($this->host->user)->get("/api/host/pay/periods/{$period->id}/export")
            ->assertOk()
            ->assertHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    public function test_finance_closes_a_period_early_when_the_brand_stops(): void
    {
        $period = app(PayrollService::class)->openPeriod($this->brand);
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/close")->assertJsonValidationErrors('period'); // no hours yet

        $this->workSession($this->host, '2026-10-02', 2);
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/close")->assertOk();

        $period->refresh();
        $this->assertSame('waiting_payment', $period->status);
        $this->assertSame('2026-10-05', $period->period_end->toDateString()); // today
        $this->assertSame($this->finance->id, $period->closed_by);
        $this->assertSame('in_progress', $this->period('2026-10-06')->status);

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/close")->assertJsonValidationErrors('period');
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();
        $this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$period->id}")->assertJsonPath('summary.achieved_hours', 2);
    }

    public function test_lowering_the_target_closes_a_period_that_already_reached_it(): void
    {
        $this->workSession($this->host, '2026-10-02', 6);

        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$this->brand->id}", ['target_hours_per_period' => 5])->assertOk();

        $period = $this->period('2026-10-01');
        $this->assertSame('waiting_payment', $period->status);
        $this->assertSame(5, $period->target_hours);
    }

    public function test_request_locks_pay_at_todays_rate_and_splits_hours_over_the_target(): void
    {
        $other = $this->newHost();
        $other->update(['rate_category_id' => HostRateCategory::where('name', 'Di atas 1 tahun')->value('id'), 'rate_category_overridden' => true]);
        $this->workSession($this->host, '2026-10-02', 7);
        $this->workSession($other, '2026-10-03', 5); // 12 of 10: closes
        $period = $this->period('2026-10-01');

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();

        // A later rate change does not touch the locked period
        HostRateCategory::where('name', 'Di bawah 1 tahun')->update(['rate_per_hour' => 99999]);

        $hosts = collect($this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$period->id}")
            ->assertJsonPath('period.status', 'requested')
            ->assertJsonPath('summary.worked_hours', 12)
            ->assertJsonPath('summary.achieved_hours', 10) // capped at the target
            ->assertJsonPath('summary.carried_out_hours', 2)
            ->assertJsonPath('summary.total_amount', 220850) // 5,83 × 20.000 + 4,17 × 25.000
            ->json('hosts'))->keyBy('host_id');

        // Both hosts get 10/12 of their hours now; the rest waits for the next period
        $this->assertFalse($hosts[$this->host->id]['estimate']);
        $this->assertSame([7, 5.83, 1.17], [$hosts[$this->host->id]['worked_hours'], $hosts[$this->host->id]['hours'], $hosts[$this->host->id]['carried_out_hours']]);
        $this->assertSame([5, 4.17, 0.83], [$hosts[$other->id]['worked_hours'], $hosts[$other->id]['hours'], $hosts[$other->id]['carried_out_hours']]);

        $this->assertSame(2.0, $this->period('2026-10-04')->carried_in_hours);
    }

    public function test_carried_hours_are_paid_first_in_the_next_period(): void
    {
        $this->workSession($this->host, '2026-10-02', 12); // target 10: closes on 2 Oct
        $first = $this->period('2026-10-01');
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$first->id}/request")->assertOk();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$first->id}/paid")->assertOk();

        $slip = SalarySlip::firstOrFail();
        $this->assertSame(200000.0, $slip->gross_amount);
        $this->actingAs($this->finance)->getJson("/api/finance/payroll/slips/{$slip->id}")
            ->assertJsonPath('slip.worked_hours', 12)
            ->assertJsonPath('slip.hours', 10)
            ->assertJsonPath('slip.carried_out_hours', 2);

        // The 2 carried hours count first: only 8 more fit, the 9th carries again
        $this->workSession($this->host, '2026-10-09', 9);
        $second = $this->period('2026-10-03');
        $this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$second->id}")
            ->assertJsonPath('hosts.0.carried_in_hours', 2)
            ->assertJsonPath('hosts.0.worked_hours', 9)
            ->assertJsonPath('hosts.0.hours', 10)
            ->assertJsonPath('hosts.0.carried_out_hours', 1)
            ->assertJsonPath('summary.achieved_hours', 10)
            ->assertJsonPath('summary.carried_out_hours', 1);

        $this->actingAs($this->host->user)->getJson('/api/host/pay')
            ->assertJsonPath('current.0.carried_in_hours', 2)
            ->assertJsonPath('current.0.estimate', 200000);
    }

    public function test_carried_hours_alone_can_fill_the_next_period(): void
    {
        $other = $this->newHost();
        $this->workSession($this->host, '2026-10-02', 16); // closes on 2 Oct
        $this->workSession($other, '2026-10-02', 4); // 20 hours: half paid, half carried (host 8, other 2)
        $first = $this->period('2026-10-01');
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$first->id}/request")->assertOk();

        // The 10 carried hours fill the next target on their own, so it closes right away
        $second = $this->period('2026-10-03');
        $this->assertSame('waiting_payment', $second->status);
        $hosts = collect($this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$second->id}")
            ->assertJsonPath('summary.carried_in_hours', 10)
            ->assertJsonPath('summary.achieved_hours', 10)
            ->assertJsonPath('summary.carried_out_hours', 0)
            ->json('hosts'))->keyBy('host_id');

        $this->assertSame([8, 8, 0], [$hosts[$this->host->id]['carried_in_hours'], $hosts[$this->host->id]['hours'], $hosts[$this->host->id]['carried_out_hours']]);
        $this->assertSame([2, 2, 0], [$hosts[$other->id]['carried_in_hours'], $hosts[$other->id]['hours'], $hosts[$other->id]['carried_out_hours']]);

        // New hours go to the period after
        $this->assertNotSame($second->id, $this->workSession($other, '2026-10-09', 3)->payment_period_id);
    }

    public function test_previous_period_with_hours_must_be_requested_first(): void
    {
        $this->workSession($this->host, '2026-10-02', 10);
        $this->workSession($this->host, '2026-10-03', 10);
        $first = $this->period('2026-10-01');
        $second = $this->period('2026-10-03');

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$second->id}/request")->assertJsonValidationErrors('period');

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$first->id}/request")->assertOk();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$second->id}/request")->assertOk();
    }

    public function test_backup_the_requester_pays_for_counts_for_the_brand_but_not_on_payroll(): void
    {
        $cover = $this->newHost();
        $this->workSession($cover, '2026-10-03', 2, backup: $this->backup('2026-10-03', 'permit', $cover));
        $this->workSession($this->host, '2026-10-02', 3);
        $period = $this->period('2026-10-01');

        $hosts = collect($this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$period->id}")
            ->assertJsonPath('summary.worked_hours', 5)
            ->assertJsonPath('summary.host_paid_hours', 2)
            ->assertJsonPath('summary.achieved_hours', 5) // the brand still pays for the live
            ->assertJsonPath('summary.total_amount', 60000) // only the host's own 3 hours
            ->json('hosts'))->keyBy('host_id');

        $this->assertSame(0, $hosts[$cover->id]['hours']);
        $this->assertSame([['payer' => $this->host->user->name, 'hours' => 2]], $hosts[$cover->id]['host_paid']);

        $this->endFirstPeriod();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/paid")->assertOk();

        $this->assertSame(2.0, $period->fresh()->host_paid_hours);
        $this->assertSame(0, SalarySlip::where('host_id', $cover->id)->count());
    }

    public function test_sick_cover_with_a_letter_on_time_is_paid_by_the_agency(): void
    {
        Storage::fake('local');
        $cover = $this->newHost();
        $backup = $this->backup('2026-10-03', 'sick', $cover);

        $this->travelTo(CarbonImmutable::parse('2026-10-03 18:00')); // letter due 4 Oct 10:00
        app(BackupService::class)->attachLetter($backup, UploadedFile::fake()->create('surat.pdf', 50, 'application/pdf'), $this->host->user);
        $this->workSession($cover, '2026-10-03', 2, backup: $backup);

        $this->actingAs($this->finance)->getJson('/api/finance/payroll/periods/'.$this->period('2026-10-01')->id)
            ->assertJsonPath('summary.host_paid_hours', 0)
            ->assertJsonPath('hosts.0.hours', 2)
            ->assertJsonPath('hosts.0.amount', 40000);
    }

    public function test_sick_cover_waits_for_the_letter_and_without_one_the_requester_pays(): void
    {
        $cover = $this->newHost();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 13:00'));
        $this->workSession($cover, '2026-10-07', 2, backup: $this->backup('2026-10-07', 'sick', $cover)); // letter due 8 Oct 10:00
        $period = $this->endFirstPeriod(); // 8 Oct 09:00

        $this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$period->id}")->assertJsonPath('pending_letters', 1);
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertJsonValidationErrors('period');

        $this->travelTo(CarbonImmutable::parse('2026-10-08 10:30'));
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();
        $this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$period->id}")
            ->assertJsonPath('summary.host_paid_hours', 2)
            ->assertJsonPath('summary.total_amount', 0);
    }

    public function test_locked_period_takes_no_changes_and_late_sessions_move_on(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $period = $this->endFirstPeriod();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/adjustments", [
            'host_id' => $this->host->id, 'sessions_added' => 1, 'hours_added' => 1, 'notes' => 'Too late',
        ])->assertJsonValidationErrors('period');

        // A report for 6 Oct approved only now goes to the next period
        $late = $this->workSession($this->host, '2026-10-06', 1);
        $this->assertSame($this->period('2026-10-09')->id, $late->payment_period_id);
    }

    public function test_paid_period_creates_slips_and_deducts_kasbon(): void
    {
        $this->actingAs($this->finance)->postJson('/api/finance/cash-advances', [
            'host_id' => $this->host->id, 'type' => 'loan', 'total_amount' => 30001, 'installment_count' => 2,
        ])->assertCreated()->assertJsonPath('advance.installments.0.amount', 15000)->assertJsonPath('advance.installments.1.amount', 15001);

        $this->workSession($this->host, '2026-10-02', 2); // 40.000
        $period = $this->endFirstPeriod();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/paid", ['reference' => 'TRF 0042'])->assertOk();

        $this->assertSame('TRF 0042', $period->paymentRequest()->firstOrFail()->payment_reference);

        $slip = SalarySlip::firstOrFail();
        $this->assertSame(40000.0, $slip->gross_amount);
        $this->assertSame(15000.0, $slip->advance_deduction);
        $this->assertSame(25000.0, $slip->net_amount);
        $this->assertSame('in_progress', CashAdvance::firstOrFail()->status);

        $this->actingAs($this->finance)->getJson("/api/finance/payroll/slips/{$slip->id}")
            ->assertJsonPath('slip.deductions.0.seq', 1)
            ->assertJsonPath('slip.deductions.0.installment_count', 2);

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/paid")->assertJsonValidationErrors('period');
    }

    public function test_installment_bigger_than_the_slip_waits_and_shows_as_skipped(): void
    {
        $this->recordAdvance(50000, 1);

        $this->workSession($this->host, '2026-10-02', 2); // 40.000 < 50.000
        $period = $this->endFirstPeriod();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request");
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/paid")->assertOk();

        $slip = SalarySlip::firstOrFail();
        $this->assertSame(40000.0, $slip->net_amount);
        $this->assertSame('unpaid', CashAdvance::firstOrFail()->status);

        $this->actingAs($this->finance)->getJson("/api/finance/payroll/slips/{$slip->id}")
            ->assertJsonPath('slip.skipped_deductions.0.amount', 50000)
            ->assertJsonPath('slip.skipped_deductions.0.seq', 1);
        $this->actingAs($this->finance)->getJson('/api/finance/cash-advances')
            ->assertJsonPath('advances.0.installments.0.status', 'scheduled')
            ->assertJsonPath('advances.0.installments.0.skip_count', 1);
    }

    public function test_request_waits_until_reports_in_the_period_are_reviewed(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $flagged = $this->liveReport($this->host, '2026-10-04', 2, 'flagged');
        $this->liveReport($this->host, '2026-10-09', 2, 'flagged'); // next period: doesn't block
        $period = $this->endFirstPeriod();

        $this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$period->id}")->assertJsonPath('pending_reports', 1);
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertJsonValidationErrors('period');

        $flagged->update(['status' => 'rejected']);
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();
    }

    public function test_cancelling_a_request_unlocks_the_period_and_keeps_history(): void
    {
        $this->workSession($this->host, '2026-10-02', 12); // 2 hours over the target carry out
        $period = $this->period('2026-10-01');
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();
        $this->assertSame(2.0, $this->period('2026-10-03')->carried_in_hours);

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/cancel-request")->assertJsonValidationErrors('reason');
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/cancel-request", ['reason' => 'Wrong hours for one host'])
            ->assertOk();

        $this->assertSame('waiting_payment', $period->fresh()->status);
        $this->assertSame(0, $period->items()->count());
        $this->assertSame(0.0, $this->period('2026-10-03')->carried_in_hours);

        // Open again: adjust, then request a second time
        $this->travel(10)->minutes();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/adjustments", [
            'host_id' => $this->host->id, 'sessions_added' => 0, 'hours_added' => -1, 'notes' => 'Counted an hour twice',
        ])->assertCreated();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();

        $this->actingAs($this->finance)->getJson("/api/finance/payroll/periods/{$period->id}")
            ->assertJsonPath('period.payment_request.status', 'requested')
            ->assertJsonPath('summary.carried_out_hours', 1)
            ->assertJsonCount(2, 'requests')
            ->assertJsonPath('requests.1.status', 'cancelled')
            ->assertJsonPath('requests.1.cancel_reason', 'Wrong hours for one host');
    }

    public function test_paid_period_or_one_whose_next_is_locked_cannot_be_cancelled(): void
    {
        $this->workSession($this->host, '2026-10-02', 10);
        $this->workSession($this->host, '2026-10-03', 10);
        $first = $this->period('2026-10-01');
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$first->id}/request")->assertOk();

        $second = $this->period('2026-10-03');
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$second->id}/request")->assertOk();

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$first->id}/cancel-request", ['reason' => 'Mistake'])
            ->assertJsonValidationErrors('period');

        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$second->id}/paid")->assertOk();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$second->id}/cancel-request", ['reason' => 'Mistake'])
            ->assertJsonValidationErrors('period');
    }

    public function test_kasbon_can_be_paid_back_outside_payroll(): void
    {
        $id = $this->recordAdvance(30000, 3);

        $this->actingAs($this->finance)->postJson("/api/finance/cash-advances/{$id}/settle", ['note' => 'Paid in cash'])->assertOk();

        $advance = CashAdvance::findOrFail($id);
        $this->assertSame('paid', $advance->status);
        $this->assertSame('Paid in cash', $advance->settled_note);
        $this->assertSame(3, $advance->installments()->where('status', 'settled')->count());

        $this->actingAs($this->finance)->postJson("/api/finance/cash-advances/{$id}/settle")->assertJsonValidationErrors('advance');
        $this->actingAs($this->finance)->deleteJson("/api/finance/cash-advances/{$id}")->assertStatus(422);

        // A settled kasbon is no longer deducted
        $this->workSession($this->host, '2026-10-02', 2);
        $period = $this->endFirstPeriod();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request");
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/paid")->assertOk();
        $this->assertSame(0.0, SalarySlip::firstOrFail()->advance_deduction);
    }

    public function test_remaining_kasbon_can_be_spread_over_new_installments(): void
    {
        $id = $this->recordAdvance(30000, 2); // 15.000 + 15.000

        $this->workSession($this->host, '2026-10-02', 2);
        $period = $this->endFirstPeriod();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request");
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/paid")->assertOk();

        // 15.000 left → 3 installments of 5.000, numbered after the one already deducted
        $this->actingAs($this->finance)->postJson("/api/finance/cash-advances/{$id}/reschedule", ['installment_count' => 3])
            ->assertOk()
            ->assertJsonPath('advance.installment_count', 4)
            ->assertJsonPath('advance.installments.0.status', 'deducted')
            ->assertJsonPath('advance.installments.1.seq', 2)
            ->assertJsonPath('advance.installments.3.seq', 4)
            ->assertJsonPath('advance.installments.3.amount', 5000);

        $this->actingAs($this->finance)->getJson('/api/finance/cash-advances')->assertJsonPath('advances.0.remaining_amount', 15000);
    }

    public function test_open_kasbon_may_not_exceed_the_monthly_salary_by_schedule(): void
    {
        $this->actingAs($this->finance)->getJson("/api/finance/cash-advances/limit/{$this->host->id}")
            ->assertJsonPath('limit.monthly_salary', 260000)
            ->assertJsonPath('limit.available', 260000);

        $this->recordAdvance(200000, 2);

        // Rp 200.000 still open of Rp 260.000: at most Rp 60.000 more
        $this->actingAs($this->finance)->postJson('/api/finance/cash-advances', [
            'host_id' => $this->host->id, 'type' => 'loan', 'total_amount' => 60001, 'installment_count' => 1,
        ])->assertJsonValidationErrors('total_amount');
        $this->recordAdvance(60000, 1);

        $this->actingAs($this->finance)->getJson("/api/finance/cash-advances/limit/{$this->host->id}")
            ->assertJsonPath('limit.outstanding', 260000)
            ->assertJsonPath('limit.available', 0);

        // No schedule, no monthly salary
        $this->actingAs($this->finance)->postJson('/api/finance/cash-advances', [
            'host_id' => $this->newHost()->id, 'type' => 'loan', 'total_amount' => 10000, 'installment_count' => 1,
        ])->assertJsonValidationErrors('total_amount');
    }

    public function test_kasbon_paid_back_frees_the_limit_again(): void
    {
        $id = $this->recordAdvance(260000, 2);
        $this->actingAs($this->finance)->postJson("/api/finance/cash-advances/{$id}/settle")->assertOk();

        $this->recordAdvance(260000, 1);
    }

    public function test_kasbon_with_deductions_cannot_be_removed(): void
    {
        $id = $this->actingAs($this->finance)->postJson('/api/finance/cash-advances', [
            'host_id' => $this->host->id, 'type' => 'loan', 'total_amount' => 10000, 'installment_count' => 1,
        ])->json('advance.id');

        $this->actingAs($this->finance)->deleteJson("/api/finance/cash-advances/{$id}")->assertOk();
        $this->assertSame(0, CashAdvance::count());
    }

    public function test_brand_report_lists_hours_and_sessions_but_no_pay(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $period = $this->period('2026-10-01');

        $sheets = $this->xlsxSheets(
            $this->actingAs($this->admin)->get("/api/finance/payroll/periods/{$period->id}/export")
                ->assertOk()
                ->assertDownload('brand-a-2026-10-01.xlsx')
        );

        $this->assertSame(['Ringkasan', 'Sesi Live', 'Penyesuaian'], array_keys($sheets));
        $this->assertEquals(10, $this->xlsxValue($sheets['Ringkasan'], 'Target jam'));
        $this->assertEquals(2, $this->xlsxValue($sheets['Ringkasan'], 'Jam yang ditagihkan'));
        $this->assertEquals([$this->host->user->name, 1, 0, 2, 2, 0], $this->xlsxTable($sheets['Ringkasan'], 'Host')[1]);

        $sessions = $this->xlsxTable($sheets['Sesi Live'], 'Tanggal');
        $this->assertSame($this->host->user->name, $sessions[1][2]);
        $this->assertEquals(2, $sessions[1][5]);

        // For the brand: no rates or pay anywhere
        $headers = collect($sheets)->flatten()->filter(fn ($cell) => is_string($cell))->implode('|');
        $this->assertStringNotContainsString('Gaji', $headers);
        $this->assertStringNotContainsString('Tarif', $headers);
    }

    public function test_finance_report_covers_a_day_week_month_year_or_everything(): void
    {
        $this->workSession($this->host, '2026-10-02', 2); // 40.000
        $period = $this->endFirstPeriod();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request")->assertOk();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/paid")->assertOk();
        $name = $this->host->user->name;

        $report = fn (string $query) => $this->xlsxSheets($this->actingAs($this->admin)->get("/api/finance/payroll/report?{$query}")->assertOk());

        $month = $report('range=month&date=2026-10-20');
        $this->assertSame(['Ringkasan', 'Rekap Host', 'Sesi Live', 'Periode', 'Slip Gaji', 'Kasbon', 'Cicilan Kasbon'], array_keys($month));
        $this->assertSame(1, $this->xlsxValue($month['Ringkasan'], 'Sesi live'));
        $this->assertEquals(40000, $this->xlsxValue($month['Ringkasan'], 'Gaji kotor'));
        $this->assertEquals([$name, 'Brand A', 1, 2, 1, 40000, 0, 40000, 0, 0], $this->xlsxTable($month['Rekap Host'], 'Host')[1]);
        $this->assertSame('Lunas', $this->xlsxTable($month['Periode'], 'Brand')[1][3]);

        // The session was on Fri 2 Oct; Sat 3 Oct had none
        $this->assertCount(2, $this->xlsxTable($report('range=day&date=2026-10-02')['Sesi Live'], 'Tanggal'));
        $this->assertSame('Tidak ada sesi live di rentang ini.', $this->xlsxTable($report('range=day&date=2026-10-03')['Sesi Live'], 'Tanggal')[1][0]);
        $this->assertSame(1, $this->xlsxValue($report('range=week&date=2026-09-30')['Ringkasan'], 'Sesi live'));
        $this->assertSame(1, $this->xlsxValue($report('range=year&date=2026-01-01')['Ringkasan'], 'Sesi live'));
        $this->assertSame(1, $this->xlsxValue($report('range=all')['Ringkasan'], 'Sesi live'));
        $this->assertSame(0, $this->xlsxValue($report('range=custom&from=2026-10-03&to=2026-10-04')['Ringkasan'], 'Sesi live'));

        $other = Brand::create(['name' => 'Brand B', 'target_hours_per_period' => 10, 'payment_cycle_days' => 7, 'payroll_start_date' => '2026-10-01']);
        $this->assertSame(0, $this->xlsxValue($report("range=all&brand_id={$other->id}")['Ringkasan'], 'Sesi live'));

        $this->actingAs($this->finance)->getJson('/api/finance/payroll/report?range=custom&from=2026-10-05&to=2026-10-01')->assertJsonValidationErrors('to');
        $this->actingAs($this->finance)->getJson('/api/finance/payroll/report?range=decade')->assertJsonValidationErrors('range');
    }

    public function test_host_sees_estimate_slips_and_only_their_own_slip(): void
    {
        $this->workSession($this->host, '2026-10-02', 2);
        $this->actingAs($this->host->user)->getJson('/api/host/pay')
            ->assertJsonPath('current.0.hours', 2)
            ->assertJsonPath('current.0.estimate', 40000);

        $period = $this->endFirstPeriod();
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/request");
        $this->actingAs($this->finance)->postJson("/api/finance/payroll/periods/{$period->id}/paid");
        $slip = SalarySlip::firstOrFail();

        $this->actingAs($this->host->user)->getJson('/api/host/pay')->assertJsonPath('slips.0.net_amount', 40000);
        $this->actingAs($this->host->user)->getJson("/api/host/pay/slips/{$slip->id}")->assertOk()->assertJsonPath('slip.hours', 2);
        $this->actingAs($this->newHost()->user)->getJson("/api/host/pay/slips/{$slip->id}")->assertForbidden();
    }

    public function test_operator_cannot_open_payroll(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->getJson('/api/finance/payroll/periods')->assertForbidden();
    }

    /** Another brand (payroll from 1 Sep, target 10 h) with one period in `$status`. */
    private function brandPeriod(string $name, string $status, array $attributes = []): PaymentPeriod
    {
        $brand = Brand::create(['name' => $name, 'target_hours_per_period' => 10, 'payroll_start_date' => '2026-09-01']);

        return PaymentPeriod::create(['brand_id' => $brand->id, 'period_start' => '2026-09-01', 'target_hours' => 10, 'status' => $status, ...$attributes]);
    }

    /** A locked period's request and the host pay snapshotted with it. */
    private function lockedPay(PaymentPeriod $period, string $requestedAt, float $amount, ?string $paidAt = null): void
    {
        $period->paymentRequests()->create([
            'requested_by' => $this->finance->id, 'requested_at' => $requestedAt,
            'status' => $paidAt ? 'paid' : 'requested', 'paid_at' => $paidAt,
        ]);
        $period->items()->create([
            'host_id' => $this->host->id, 'session_count' => 1, 'hours' => $amount / 20000, 'rate_per_hour' => 20000, 'amount' => $amount,
        ]);
    }

    public function test_period_list_puts_what_waits_longest_first_under_action(): void
    {
        $this->brandPeriod('Teh', 'waiting_payment', ['period_end' => '2026-10-02', 'closed_at' => '2026-10-02 20:00']);
        $kopi = $this->brandPeriod('Kopi', 'requested', ['period_end' => '2026-09-20', 'closed_at' => '2026-09-20 20:00']);
        $this->lockedPay($kopi, '2026-09-22 09:00', 200000);
        $this->brandPeriod('Susu', 'in_progress');
        $this->brandPeriod('Roti', 'paid', ['period_end' => '2026-09-10', 'closed_at' => '2026-09-10 20:00']);

        $periods = $this->actingAs($this->finance)->getJson('/api/finance/payroll/periods?status=action')->assertOk()->json('data');

        $this->assertSame(['Kopi', 'Teh'], array_column(array_column($periods, 'brand'), 'name'));
        $this->assertSame(['2026-09-22T02:00:00.000000Z', '2026-10-02T13:00:00.000000Z'], array_column($periods, 'waiting_since')); // request, then the close
        $this->assertEquals(200000, $periods[0]['total_amount']);
    }

    public function test_running_periods_list_brand_by_brand_a_page_at_a_time(): void
    {
        foreach (range(1, 26) as $number) {
            $this->brandPeriod(sprintf('Kopi %02d', $number), 'in_progress');
        }
        $this->brandPeriod('Teh', 'in_progress');
        $this->brandPeriod('Susu', 'paid');

        $this->actingAs($this->finance)->getJson('/api/finance/payroll/periods?status=in_progress&page=2')
            ->assertOk()
            ->assertJsonPath('total', 27)
            ->assertJsonPath('last_page', 2)
            ->assertJsonPath('data.0.brand.name', 'Kopi 26')
            ->assertJsonPath('data.1.brand.name', 'Teh');
    }

    public function test_period_list_finds_brands_by_part_of_their_name(): void
    {
        $this->brandPeriod('Kopi Nusantara', 'in_progress');
        $this->brandPeriod('Teh Manis', 'paid');

        $this->actingAs($this->finance)->getJson('/api/finance/payroll/periods?search=nusa')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.brand.name', 'Kopi Nusantara');
    }

    public function test_period_list_rejects_an_unknown_status(): void
    {
        $this->actingAs($this->finance)->getJson('/api/finance/payroll/periods?status=lost')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('status');
    }

    public function test_payroll_summary_adds_up_pay_at_each_stage(): void
    {
        $this->workSession($this->host, '2026-10-02', 12); // Brand A reaches its 10 h: 200.000 waits for the PIC, the next period runs
        $this->lockedPay($this->brandPeriod('Kopi', 'requested'), '2026-09-28 10:00', 300000);
        $this->lockedPay($this->brandPeriod('Teh', 'requested'), '2026-10-01 10:00', 100000);
        $this->lockedPay($this->brandPeriod('Roti', 'paid'), '2026-09-29 10:00', 80000, '2026-10-02 15:00');
        $this->lockedPay($this->brandPeriod('Susu', 'paid'), '2026-09-15 10:00', 50000, '2026-09-25 15:00'); // last month
        Brand::create(['name' => 'Baru', 'target_hours_per_period' => 10]);
        Brand::create(['name' => 'Lama', 'target_hours_per_period' => 10, 'status' => 'inactive']);

        $this->actingAs($this->finance)->getJson('/api/finance/payroll/summary')
            ->assertOk()
            ->assertExactJson([
                'waiting_payment' => ['count' => 1, 'amount' => 200000],
                'requested' => ['count' => 2, 'amount' => 400000, 'oldest_requested_at' => '2026-09-28T10:00:00+07:00'],
                'in_progress' => ['count' => 1],
                'paid_this_month' => ['count' => 1, 'amount' => 80000],
                'brands_without_start' => ['count' => 1, 'names' => ['Baru']],
            ]);
    }

    public function test_operator_cannot_open_the_payroll_summary(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->getJson('/api/finance/payroll/summary')->assertForbidden();
    }
}
