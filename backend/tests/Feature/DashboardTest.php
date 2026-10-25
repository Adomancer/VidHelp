<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\DiscordLink;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\HostRateCategory;
use App\Models\HostRating;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\PayrollService;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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

    public function test_admin_dashboard_takes_the_same_number_of_queries_however_many_hosts(): void
    {
        $queries = function () {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->actingAs($this->admin)->getJson('/api/admin/dashboard')->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };

        [$first, $firstSlot] = $this->hostWithSlot('08:00', '10:00');
        $this->attend($first, $firstSlot, '07:55', '10:00');
        $queries();
        $before = $queries();
        foreach (['10:00', '12:00', '16:00', '18:00'] as $start) {
            [$host, $slot] = $this->hostWithSlot($start, CarbonImmutable::parse($start)->addHours(2)->format('H:i'));
            $this->attend($host, $slot, $start);
        }

        $this->assertSame($before, $queries());
        $this->assertCount(5, $this->actingAs($this->admin)->getJson('/api/admin/dashboard')->json('today.sessions'));
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

    public function test_backups_lists_upcoming_requests_without_a_cover_soonest_first(): void
    {
        [$host, $slot] = $this->hostWithSlot('08:00', '10:00');
        [$cover] = $this->hostWithSlot('19:00', '21:00');
        $backup = fn (string $date, string $status, string $reason = 'permit') => BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $this->brand->id, 'requesting_host_id' => $host->id, 'created_by' => $host->user_id,
            'backup_date' => $date, 'start_at' => "{$date} 08:00", 'end_at' => "{$date} 10:00",
            'reason_type' => $reason, 'status' => $status,
            'auto_open_at' => '2026-10-06 15:30', 'auto_fill_at' => "{$date} 07:30",
        ]);
        $later = $backup('2026-10-13', 'pending', 'sick');
        $later->applications()->create(['applicant_host_id' => $cover->id, 'status' => 'applied']);
        $backup('2026-10-08', 'open');
        $backup('2026-10-09', 'filled');
        $backup('2026-10-05', 'open'); // already over

        $backups = $this->actingAs($this->admin)->getJson('/api/admin/dashboard')->assertOk()->json('backups');

        $this->assertSame(['open', 'pending'], array_column($backups, 'status'));
        $this->assertSame([0, 1], array_column($backups, 'applicants_count'));
        $this->assertSame('sick', $backups[1]['reason_type']);
        $this->assertSame($host->user->name, $backups[1]['requester_name']);
        $this->assertSame('Glow', $backups[1]['brand']['name']);
    }

    public function test_only_admins_see_the_admin_dashboard(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->getJson('/api/admin/dashboard')->assertForbidden();
    }

    /** A backup request for the host's slot on `$date`, at the slot's times. */
    private function backupFor(HostProfile $host, ScheduleSlot $slot, string $date, array $attributes): BackupRequest
    {
        return BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $this->brand->id, 'requesting_host_id' => $host->id, 'created_by' => $host->user_id,
            'backup_date' => $date, 'start_at' => "{$date} {$slot->start_time}", 'end_at' => "{$date} {$slot->end_time}",
            'reason_type' => 'permit', 'status' => 'open',
            'auto_open_at' => '2026-10-06 15:30', 'auto_fill_at' => "{$date} 07:30",
            ...$attributes,
        ]);
    }

    /** Another weekly slot on the host's assignment, on Tuesdays like the first. */
    private function extraSlot(ScheduleSlot $slot, string $start, string $end): ScheduleSlot
    {
        return ScheduleSlot::create([
            'assignment_id' => $slot->assignment_id, 'day_of_week' => 2,
            'start_time' => $start, 'end_time' => $end, 'effective_from' => '2026-09-01',
        ]);
    }

    public function test_host_dashboard_lists_my_sessions_this_week_with_their_state(): void
    {
        [$host, $slot] = $this->hostWithSlot('14:00', '16:00');
        [$other] = $this->hostWithSlot('08:00', '10:00');
        $evening = $this->extraSlot($slot, '19:00', '21:00');
        $this->backupFor($host, $evening, self::TUESDAY, ['status' => 'filled', 'filled_by_host_id' => $other->id]);
        $this->attend($host, $slot, '13:58');

        $sessions = $this->actingAs($host->user)->getJson('/api/host/dashboard')->assertOk()->json('sessions');

        // Next Tuesday is past the 7 days shown, and the other host's slot is not mine
        $this->assertSame(['own', 'off'], array_column($sessions, 'role'));
        $this->assertSame(['live', null], array_column($sessions, 'state'));
        $this->assertSame($other->user->name, $sessions[1]['covered_by']);
    }

    public function test_host_dashboard_counts_what_i_still_have_to_do(): void
    {
        [$host, $slot] = $this->hostWithSlot('08:00', '10:00');
        $this->attend($host, $slot, '08:00', '10:00'); // over, no report yet
        $this->attend($host, $this->extraSlot($slot, '14:00', '16:00'), '14:00'); // still live
        $this->backupFor($host, $slot, '2026-10-13', ['reason_type' => 'sick']); // letter due, no cover yet
        $this->backupFor($host, $slot, '2026-10-20', ['status' => 'pending']); // applicants waiting
        $this->backupFor($host, $slot, '2026-10-05', ['reason_type' => 'sick', 'status' => 'filled']); // letter 24 hours late
        $this->backupFor($host, $slot, '2026-10-27', ['reason_type' => 'sick', 'status' => 'cancelled']);
        HostBrandAssignment::where('host_id', $host->id)->update(['is_leader' => true]);
        PaymentPeriod::create([
            'brand_id' => $this->brand->id, 'period_start' => '2026-10-01', 'period_end' => '2026-10-05',
            'target_hours' => 10, 'status' => 'waiting_payment',
        ]);

        $this->actingAs($host->user)->getJson('/api/host/dashboard')
            ->assertOk()
            ->assertJsonPath('attention', ['reports_to_send' => 1, 'sick_letters_due' => 1, 'backups_uncovered' => 2, 'periods_to_request' => 1]);
    }

    public function test_host_dashboard_counts_backups_i_could_still_take(): void
    {
        [$host] = $this->hostWithSlot('08:00', '10:00');
        [$requester, $slot] = $this->hostWithSlot('19:00', '21:00');
        $this->backupFor($requester, $slot, '2026-10-08', []);
        $this->backupFor($requester, $slot, '2026-10-09', ['request_type' => 'direct'])->nominees()->create(['nominee_host_id' => $host->id]);
        $this->backupFor($requester, $slot, '2026-10-10', ['request_type' => 'direct']); // asks someone else
        $this->backupFor($requester, $slot, '2026-10-11', [])->applications()->create(['applicant_host_id' => $host->id, 'status' => 'applied']);

        $this->actingAs($host->user)->getJson('/api/host/dashboard')
            ->assertOk()
            ->assertJsonPath('cover_chances', ['count' => 2, 'asked_me' => 1]);
    }

    public function test_host_dashboard_shows_my_pay_points_rating_and_hours(): void
    {
        [$host, $slot] = $this->hostWithSlot('08:00', '10:00');
        [$other, $otherSlot] = $this->hostWithSlot('10:00', '13:00');
        $this->approvedSession($this->attend($host, $slot, '08:00', '10:00'), 2, 0);
        $this->approvedSession($this->attend($other, $otherSlot, '10:00', '13:00'), 3, 0);
        HostRating::create(['host_id' => $host->id, 'month_year' => '2026-08', 'rating' => 3]);
        HostRating::create(['host_id' => $host->id, 'month_year' => '2026-09', 'rating' => 4.5]);

        $response = $this->actingAs($host->user)->getJson('/api/host/dashboard')->assertOk();

        $period = $response->json('pay.periods.0');
        $this->assertEquals(2, $period['hours']);
        $this->assertEquals(40000, $period['estimate']);
        $this->assertEquals(5, $period['brand_hours']); // both hosts count toward the target
        $this->assertEquals(10, $period['target_hours']);

        $this->assertSame(['points' => 100, 'opening_points' => 100, 'sp_level' => 0, 'period' => ['start' => '2026-10-01', 'end' => '2026-12-31']], $response->json('points'));
        $this->assertSame(['month_year' => '2026-09', 'rating' => 4.5], $response->json('rating'));

        $days = $response->json('hours_by_day');
        $this->assertEquals(['date' => self::TUESDAY, 'hours' => 2], end($days)); // mine only
    }

    public function test_host_dashboard_asks_to_connect_discord_while_unlinked(): void
    {
        [$host] = $this->hostWithSlot('08:00', '10:00');
        config(['services.discord.client_id' => 'client', 'services.discord.client_secret' => 'secret', 'services.discord.bot_token' => 'token']);

        $this->actingAs($host->user)->getJson('/api/host/dashboard')->assertOk()->assertJsonPath('discord_unlinked', true);
    }

    public function test_host_dashboard_does_not_ask_for_discord_once_linked(): void
    {
        [$host] = $this->hostWithSlot('08:00', '10:00');
        config(['services.discord.client_id' => 'client', 'services.discord.client_secret' => 'secret', 'services.discord.bot_token' => 'token']);
        DiscordLink::create(['user_id' => $host->user_id, 'discord_user_id' => '123', 'discord_username' => 'sari', 'linked_at' => now()]);

        $this->actingAs($host->user)->getJson('/api/host/dashboard')->assertOk()->assertJsonPath('discord_unlinked', false);
    }

    public function test_host_dashboard_returns_404_without_a_host_profile(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->getJson('/api/host/dashboard')
            ->assertNotFound()
            ->assertJsonPath('message', 'Kamu tidak punya profil host.');
    }
}
