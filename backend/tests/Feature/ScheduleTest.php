<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Models\LiveReport;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\WorkSession;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ScheduleTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $operator;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
        $this->operator = User::factory()->create();
        $this->operator->assignRole('operator');
    }

    private function brand(): Brand
    {
        return Brand::create(['name' => 'Brand '.uniqid(), 'target_hours_per_period' => 100]);
    }

    /** A host on a brand. Pass an existing assignment's host to put the same host on another brand. */
    private function assignment(Brand $brand, ?HostBrandAssignment $sameHostAs = null): HostBrandAssignment
    {
        if ($sameHostAs) {
            $hostId = $sameHostAs->host_id;
        } else {
            $user = User::factory()->create();
            $user->assignRole('host');
            $user->ensureHostProfile();
            $hostId = $user->hostProfile->id;
        }

        return HostBrandAssignment::create(['host_id' => $hostId, 'brand_id' => $brand->id, 'status' => 'active']);
    }

    private function addSlot(HostBrandAssignment $assignment, int $day, string $start, string $end, array $extra = [])
    {
        return $this->actingAs($this->operator)->postJson('/api/operator/schedules', [
            'assignment_id' => $assignment->id,
            'day_of_week' => $day,
            'start_time' => $start,
            'end_time' => $end,
            ...$extra,
        ]);
    }

    /** One slot per day, e.g. every day. */
    private function addSlotOnDays(HostBrandAssignment $assignment, array $days, string $start, string $end)
    {
        return $this->actingAs($this->operator)->postJson('/api/operator/schedules', [
            'assignment_id' => $assignment->id,
            'days_of_week' => $days,
            'start_time' => $start,
            'end_time' => $end,
        ]);
    }

    public function test_operator_adds_a_weekly_slot(): void
    {
        $assignment = $this->assignment($this->brand());

        $this->addSlot($assignment, 1, '14:00', '15:00')
            ->assertCreated()
            ->assertJsonPath('slot.day_of_week', 1)
            ->assertJsonPath('slot.crosses_midnight', false)
            ->assertJsonPath('slot.effective_from', today()->toDateString());
    }

    public function test_overnight_slot_is_flagged(): void
    {
        $this->addSlot($this->assignment($this->brand()), 1, '23:00', '01:00')
            ->assertCreated()
            ->assertJsonPath('slot.crosses_midnight', true);
    }

    public function test_two_hosts_cannot_overlap_on_the_same_brand(): void
    {
        $brand = $this->brand();
        $this->addSlot($this->assignment($brand), 1, '14:00', '16:00')->assertCreated();

        $this->addSlot($this->assignment($brand), 1, '15:00', '17:00')->assertJsonValidationErrors('start_time');
    }

    public function test_back_to_back_slots_are_fine(): void
    {
        $brand = $this->brand();
        $this->addSlot($this->assignment($brand), 1, '14:00', '15:00')->assertCreated();

        $this->addSlot($this->assignment($brand), 1, '15:00', '16:00')->assertCreated();
    }

    public function test_host_cannot_be_on_two_brands_at_once(): void
    {
        $first = $this->assignment($this->brand());
        $second = $this->assignment($this->brand(), sameHostAs: $first);

        $this->addSlot($first, 2, '16:00', '18:00')->assertCreated();

        $this->addSlot($second, 2, '17:00', '19:00')->assertJsonValidationErrors('start_time');
        $this->addSlot($second, 2, '18:00', '19:00')->assertCreated();
    }

    public function test_overnight_slot_clashes_with_next_morning(): void
    {
        $brand = $this->brand();
        $this->addSlot($this->assignment($brand), 1, '23:00', '01:00')->assertCreated();

        $this->addSlot($this->assignment($brand), 2, '00:30', '02:00')->assertJsonValidationErrors('start_time');
    }

    public function test_sunday_night_slot_clashes_with_monday_morning(): void
    {
        $brand = $this->brand();
        $this->addSlot($this->assignment($brand), 7, '23:00', '01:00')->assertCreated();

        $this->addSlot($this->assignment($brand), 1, '00:00', '00:30')->assertJsonValidationErrors('start_time');
    }

    public function test_same_time_is_fine_when_periods_do_not_overlap(): void
    {
        $brand = $this->brand();
        $nextWeek = today()->addWeek()->toDateString();

        $this->addSlot($this->assignment($brand), 1, '14:00', '15:00', [
            'effective_to' => today()->addDays(6)->toDateString(),
        ])->assertCreated();

        $this->addSlot($this->assignment($brand), 1, '14:00', '15:00', ['effective_from' => $nextWeek])->assertCreated();
    }

    public function test_slot_needs_an_active_assignment(): void
    {
        $assignment = $this->assignment($this->brand());
        $assignment->update(['status' => 'inactive']);

        $this->addSlot($assignment, 1, '14:00', '15:00')->assertJsonValidationErrors('assignment_id');
    }

    public function test_locked_slot_can_only_be_changed_by_admin(): void
    {
        $id = $this->addSlot($this->assignment($this->brand()), 1, '14:00', '15:00')->json('slot.id');

        $this->actingAs($this->operator)->putJson("/api/admin/schedules/{$id}/lock", ['is_locked' => true])->assertForbidden();
        $this->actingAs($this->admin)->putJson("/api/admin/schedules/{$id}/lock", ['is_locked' => true])->assertOk();

        $this->actingAs($this->operator)->putJson("/api/operator/schedules/{$id}", ['end_time' => '16:00'])->assertForbidden();
        $this->actingAs($this->operator)->deleteJson("/api/operator/schedules/{$id}")->assertForbidden();

        $this->actingAs($this->admin)->putJson("/api/operator/schedules/{$id}", ['end_time' => '16:00'])
            ->assertOk()
            ->assertJsonPath('slot.end_time', '16:00');
    }

    public function test_removing_a_running_slot_keeps_its_history(): void
    {
        $slot = ScheduleSlot::create([
            'assignment_id' => $this->assignment($this->brand())->id,
            'day_of_week' => 1, 'start_time' => '14:00', 'end_time' => '15:00',
            'effective_from' => today()->subMonth(),
        ]);

        $this->actingAs($this->operator)->deleteJson("/api/operator/schedules/{$slot->id}")->assertOk();

        $this->assertTrue($slot->fresh()->effective_to->isYesterday());
    }

    public function test_removing_a_future_slot_deletes_it(): void
    {
        $id = $this->addSlot($this->assignment($this->brand()), 1, '14:00', '15:00', [
            'effective_from' => today()->addWeek()->toDateString(),
        ])->json('slot.id');

        $this->actingAs($this->operator)->deleteJson("/api/operator/schedules/{$id}")->assertOk();

        $this->assertNull(ScheduleSlot::find($id));
    }

    public function test_removing_a_slot_someone_already_went_live_on_keeps_the_paid_hours(): void
    {
        // Added today, worked today, removed today
        $assignment = $this->assignment($this->brand());
        $slot = ScheduleSlot::find($this->addSlot($assignment, today()->dayOfWeekIso, '08:00', '10:00')->json('slot.id'));
        $date = today()->toDateString();
        $attendance = Attendance::create([
            'host_id' => $assignment->host_id, 'slot_id' => $slot->id, 'brand_id' => $assignment->brand_id, 'session_date' => $date,
            'scheduled_start_at' => "{$date} 08:00", 'scheduled_end_at' => "{$date} 10:00",
            'check_in_at' => "{$date} 08:00", 'check_out_at' => "{$date} 10:00", 'report_due_at' => "{$date} 23:59",
        ]);
        $report = LiveReport::create([
            'attendance_id' => $attendance->id, 'host_id' => $assignment->host_id, 'brand_id' => $assignment->brand_id,
            'session_count' => 1, 'duration_hours' => 2, 'status' => 'approved', 'submitted_at' => now(),
        ]);
        $session = WorkSession::create([
            'live_report_id' => $report->id, 'host_id' => $assignment->host_id, 'brand_id' => $assignment->brand_id,
            'session_date' => $date, 'start_at' => "{$date} 08:00", 'end_at' => "{$date} 10:00", 'duration_hours' => 2,
        ]);

        $this->actingAs($this->operator)->deleteJson("/api/operator/schedules/{$slot->id}")->assertOk();

        $this->assertSame('inactive', $slot->fresh()->status);
        $this->assertNotNull($attendance->fresh());
        $this->assertNotNull($report->fresh());
        $this->assertNotNull($session->fresh());
    }

    public function test_removing_a_future_slot_with_a_backup_cancels_the_backup_and_keeps_its_record(): void
    {
        $assignment = $this->assignment($this->brand());
        $cover = $this->assignment($this->brand());
        $slot = ScheduleSlot::find($this->addSlot($assignment, 1, '14:00', '16:00', [
            'effective_from' => today()->addWeek()->toDateString(),
        ])->json('slot.id'));
        $start = today()->addWeeks(2)->startOfWeek()->setTime(14, 0);
        $backup = BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $assignment->brand_id, 'requesting_host_id' => $assignment->host_id,
            'backup_date' => $start->toDateString(), 'start_at' => $start, 'end_at' => $start->copy()->addHours(2),
            'reason_type' => 'permit', 'request_type' => 'open', 'status' => 'filled', 'filled_by_host_id' => $cover->host_id,
            'auto_fill_at' => $start->copy()->subMinutes(30),
        ]);

        $this->actingAs($this->operator)->deleteJson("/api/operator/schedules/{$slot->id}")->assertOk();

        $this->assertSame('inactive', $slot->fresh()->status);
        $this->assertSame('cancelled', $backup->fresh()->status);
        $this->assertNull($backup->fresh()->filled_by_host_id);
    }

    public function test_the_database_refuses_to_delete_a_slot_with_a_check_in(): void
    {
        $assignment = $this->assignment($this->brand());
        $slot = ScheduleSlot::create([
            'assignment_id' => $assignment->id, 'day_of_week' => 1, 'start_time' => '14:00', 'end_time' => '15:00',
            'effective_from' => today(),
        ]);
        Attendance::create([
            'host_id' => $assignment->host_id, 'slot_id' => $slot->id, 'brand_id' => $assignment->brand_id, 'session_date' => today(),
            'scheduled_start_at' => today()->setTime(14, 0), 'scheduled_end_at' => today()->setTime(15, 0), 'check_in_at' => today()->setTime(14, 0),
            'report_due_at' => today()->setTime(23, 59),
        ]);

        $this->expectException(QueryException::class);
        $slot->delete();
    }

    public function test_stopping_a_slot_from_a_later_date(): void
    {
        $slot = ScheduleSlot::create([
            'assignment_id' => $this->assignment($this->brand())->id,
            'day_of_week' => 1, 'start_time' => '14:00', 'end_time' => '15:00',
            'effective_from' => today()->subMonth(),
        ]);

        $this->actingAs($this->operator)->deleteJson("/api/operator/schedules/{$slot->id}?from=".today()->subDay()->toDateString())
            ->assertJsonValidationErrors('from');

        $this->actingAs($this->operator)->deleteJson("/api/operator/schedules/{$slot->id}?from=".today()->addWeek()->toDateString())
            ->assertOk();

        $this->assertSame(today()->addDays(6)->toDateString(), $slot->fresh()->effective_to->toDateString());
    }

    public function test_editing_from_a_later_date_keeps_the_weeks_before(): void
    {
        $slot = ScheduleSlot::create([
            'assignment_id' => $this->assignment($this->brand())->id,
            'day_of_week' => 1, 'start_time' => '14:00', 'end_time' => '15:00',
            'effective_from' => today()->subMonth(),
        ]);
        $nextWeek = today()->addWeek()->toDateString();

        $this->actingAs($this->operator)->putJson("/api/operator/schedules/{$slot->id}", ['end_time' => '16:00', 'apply_from' => $nextWeek])
            ->assertOk()
            ->assertJsonPath('slot.end_time', '16:00')
            ->assertJsonPath('slot.effective_from', $nextWeek)
            ->assertJsonPath('slot.previous_slot_id', $slot->id);

        $slot->refresh();
        $this->assertSame('15:00', $slot->end_time);
        $this->assertSame(today()->addDays(6)->toDateString(), $slot->effective_to->toDateString());
    }

    public function test_editing_a_slot_that_has_not_started_changes_it_in_place(): void
    {
        $id = $this->addSlot($this->assignment($this->brand()), 1, '14:00', '15:00', [
            'effective_from' => today()->addWeeks(2)->toDateString(),
        ])->json('slot.id');

        $this->actingAs($this->operator)
            ->putJson("/api/operator/schedules/{$id}", ['end_time' => '16:00', 'apply_from' => today()->addWeek()->toDateString()])
            ->assertOk()
            ->assertJsonPath('slot.id', $id)
            ->assertJsonPath('slot.end_time', '16:00');

        $this->assertSame(1, ScheduleSlot::count());
    }

    public function test_undoing_an_edit_brings_back_the_earlier_slot(): void
    {
        $slot = ScheduleSlot::create([
            'assignment_id' => $this->assignment($this->brand())->id,
            'day_of_week' => 1, 'start_time' => '14:00', 'end_time' => '15:00',
            'effective_from' => today()->subMonth(),
        ]);

        $newId = $this->actingAs($this->operator)
            ->putJson("/api/operator/schedules/{$slot->id}", ['end_time' => '16:00', 'apply_from' => today()->addWeek()->toDateString()])
            ->json('slot.id');

        $this->actingAs($this->operator)->postJson("/api/operator/schedules/{$newId}/undo")
            ->assertOk()
            ->assertJsonPath('slot.id', $slot->id);

        $this->assertNull(ScheduleSlot::find($newId));
        $this->assertNull($slot->fresh()->effective_to);
    }

    public function test_undoing_a_new_slot_removes_it_only_shortly_after(): void
    {
        $assignment = $this->assignment($this->brand());
        $first = $this->addSlot($assignment, 1, '14:00', '15:00')->json('slot.id');

        $this->actingAs($this->operator)->postJson("/api/operator/schedules/{$first}/undo")->assertOk();
        $this->assertNull(ScheduleSlot::find($first));

        $second = $this->addSlot($assignment, 1, '14:00', '15:00')->json('slot.id');
        $this->travel(11)->minutes();

        $this->actingAs($this->operator)->postJson("/api/operator/schedules/{$second}/undo")->assertUnprocessable();
        $this->assertNotNull(ScheduleSlot::find($second));
    }

    public function test_conflict_check_names_the_clashing_slot(): void
    {
        $first = $this->assignment($this->brand());
        $second = $this->assignment($this->brand(), sameHostAs: $first);
        $clashId = $this->addSlot($first, 2, '16:00', '18:00')->json('slot.id');

        $query = [
            'assignment_id' => $second->id, 'day_of_week' => 2, 'start_time' => '17:00', 'end_time' => '19:00',
            'effective_from' => today()->toDateString(),
        ];

        $this->actingAs($this->operator)->getJson('/api/operator/schedules/conflicts?'.http_build_query($query))
            ->assertOk()
            ->assertJsonCount(1, 'conflicts')
            ->assertJsonPath('conflicts.0.brand_name', $first->brand->name)
            ->assertJsonPath('conflicts.0.same_host', true);

        $this->actingAs($this->operator)->getJson('/api/operator/schedules/conflicts?'.http_build_query($query + ['ignore_id' => $clashId]))
            ->assertJsonCount(0, 'conflicts');
    }

    public function test_every_day_adds_one_slot_per_day(): void
    {
        $assignment = $this->assignment($this->brand());

        $this->addSlotOnDays($assignment, [7, 1, 2, 3, 4, 5, 6], '19:00', '21:00')
            ->assertCreated()
            ->assertJsonCount(7, 'slots')
            ->assertJsonPath('slots.0.day_of_week', 1)
            ->assertJsonPath('slots.6.day_of_week', 7)
            ->assertJsonPath('message', '7 slot ditambahkan');

        $this->assertEquals(range(1, 7), ScheduleSlot::where('assignment_id', $assignment->id)->orderBy('day_of_week')->pluck('day_of_week')->all());
    }

    public function test_several_days_add_nothing_when_one_day_clashes(): void
    {
        $brand = $this->brand();
        $this->addSlot($this->assignment($brand), 3, '20:00', '22:00')->assertCreated();
        $assignment = $this->assignment($brand);

        $this->addSlotOnDays($assignment, [1, 2, 3, 4, 5, 6, 7], '19:00', '21:00')
            ->assertJsonValidationErrors('start_time');

        $this->assertSame(0, ScheduleSlot::where('assignment_id', $assignment->id)->count());
    }

    public function test_conflict_check_covers_every_chosen_day(): void
    {
        $brand = $this->brand();
        $this->addSlot($this->assignment($brand), 5, '20:00', '22:00')->assertCreated();

        $query = [
            'assignment_id' => $this->assignment($brand)->id, 'days_of_week' => [1, 3, 5], 'start_time' => '19:00', 'end_time' => '21:00',
            'effective_from' => today()->toDateString(),
        ];

        $this->actingAs($this->operator)->getJson('/api/operator/schedules/conflicts?'.http_build_query($query))
            ->assertOk()
            ->assertJsonCount(1, 'conflicts')
            ->assertJsonPath('conflicts.0.day_of_week', 5)
            ->assertJsonPath('conflicts.0.same_host', false);
    }

    public function test_history_follows_an_edit_from_a_later_date(): void
    {
        $id = $this->addSlot($this->assignment($this->brand()), 1, '14:00', '15:00')->json('slot.id');

        $newId = $this->actingAs($this->operator)
            ->putJson("/api/operator/schedules/{$id}", ['end_time' => '16:00', 'apply_from' => today()->addWeek()->toDateString()])
            ->json('slot.id');

        // Added, ended for the edit, continued as the new slot
        $this->actingAs($this->operator)->getJson("/api/operator/schedules/{$newId}/history")
            ->assertOk()
            ->assertJsonCount(3, 'history');
    }

    public function test_week_view_includes_slots_starting_mid_week(): void
    {
        $brand = $this->brand();
        $monday = today()->next('Monday');
        $this->addSlot($this->assignment($brand), 4, '10:00', '12:00', [
            'effective_from' => $monday->copy()->addDays(3)->toDateString(),
        ])->assertCreated();

        $url = "/api/operator/schedules?brand_id={$brand->id}&on={$monday->toDateString()}";
        $this->actingAs($this->operator)->getJson($url)->assertJsonCount(0, 'slots');
        $this->actingAs($this->operator)->getJson("{$url}&days=7")->assertJsonCount(1, 'slots');
    }

    public function test_month_view_returns_backups_across_the_whole_range(): void
    {
        $brand = $this->brand();
        $assignment = $this->assignment($brand);
        $slot = ScheduleSlot::findOrFail($this->addSlot($assignment, 1, '10:00', '12:00')->json('slot.id'));
        $monday = today()->next('Monday');
        $later = $monday->copy()->addWeeks(3)->toDateString();
        BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $brand->id, 'requesting_host_id' => $assignment->host_id,
            'backup_date' => $later, 'start_at' => "{$later} 10:00", 'end_at' => "{$later} 12:00",
            'reason_type' => 'sick', 'status' => 'open', 'auto_fill_at' => "{$later} 09:30",
        ]);

        $url = "/api/operator/schedules?brand_id={$brand->id}&on={$monday->toDateString()}";
        // The week board still sees only its own week; the month calendar sees all six weeks
        $this->actingAs($this->operator)->getJson("{$url}&days=7")->assertOk()->assertJsonCount(0, 'backups');
        $this->actingAs($this->operator)->getJson("{$url}&days=42")->assertOk()->assertJsonCount(1, 'backups');
        $this->actingAs($this->operator)->getJson("{$url}&days=43")->assertJsonValidationErrors('days');
    }

    public function test_leaving_a_brand_removes_the_hosts_slots(): void
    {
        $assignment = $this->assignment($this->brand());
        $this->addSlot($assignment, 1, '14:00', '15:00')->assertCreated();

        $this->actingAs($this->operator)->putJson("/api/operator/assignments/{$assignment->id}", ['status' => 'inactive'])->assertOk();

        $this->actingAs($this->operator)->getJson("/api/operator/schedules?brand_id={$assignment->brand_id}")
            ->assertOk()
            ->assertJsonCount(0, 'slots');
    }

    public function test_schedule_list_is_filtered_by_brand_and_date(): void
    {
        $brand = $this->brand();
        $this->addSlot($this->assignment($brand), 3, '10:00', '12:00')->assertCreated();
        $this->addSlot($this->assignment($this->brand()), 3, '10:00', '12:00')->assertCreated();
        $this->addSlot($this->assignment($brand), 4, '10:00', '12:00', ['effective_from' => today()->addWeek()->toDateString()])->assertCreated();

        $this->actingAs($this->operator)->getJson("/api/operator/schedules?brand_id={$brand->id}")
            ->assertJsonCount(1, 'slots');
        $this->actingAs($this->operator)->getJson("/api/operator/schedules?brand_id={$brand->id}&on=".today()->addWeek()->toDateString())
            ->assertJsonCount(2, 'slots');
    }

    public function test_host_sees_own_slots_across_brands(): void
    {
        $first = $this->assignment($this->brand());
        $second = $this->assignment($this->brand(), sameHostAs: $first);
        $this->addSlot($first, 1, '14:00', '15:00')->assertCreated();
        $this->addSlot($second, 2, '16:00', '18:00')->assertCreated();
        $this->addSlot($second, 3, '16:00', '18:00', ['effective_from' => today()->addWeek()->toDateString()])->assertCreated();
        $this->addSlot($this->assignment($this->brand()), 4, '09:00', '10:00')->assertCreated(); // someone else

        $this->actingAs($first->host->user)->getJson('/api/host/schedules')
            ->assertOk()
            ->assertJsonCount(2, 'slots')
            ->assertJsonCount(1, 'upcoming');
    }

    public function test_host_calendar_sees_backups_weeks_ahead(): void
    {
        $assignment = $this->assignment($this->brand());
        $slot = ScheduleSlot::findOrFail($this->addSlot($assignment, 1, '10:00', '12:00')->json('slot.id'));
        $later = today()->next('Monday')->addWeeks(2)->toDateString();
        BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $assignment->brand_id, 'requesting_host_id' => $assignment->host_id,
            'backup_date' => $later, 'start_at' => "{$later} 10:00", 'end_at' => "{$later} 12:00",
            'reason_type' => 'permit', 'status' => 'open', 'auto_fill_at' => "{$later} 09:30",
        ]);
        $host = $assignment->host->user;

        // The default week doesn't reach it; the 4-week calendar does
        $this->actingAs($host)->getJson('/api/host/schedules')->assertOk()->assertJsonCount(0, 'absences');
        $this->actingAs($host)->getJson('/api/host/schedules?days=28')->assertOk()->assertJsonCount(1, 'absences');
        $this->actingAs($host)->getJson('/api/host/schedules?days=43')->assertJsonValidationErrors('days');
    }

    public function test_host_replaces_weekly_availability(): void
    {
        $host = $this->assignment($this->brand())->host->user;

        $this->actingAs($host)->putJson('/api/host/availability', ['ranges' => [
            ['day_of_week' => 1, 'available_from' => '08:00', 'available_to' => '17:00'],
            ['day_of_week' => 6, 'available_from' => '20:00', 'available_to' => '02:00', 'note' => 'weekend nights'],
        ]])->assertOk()->assertJsonCount(2, 'availability');

        $this->actingAs($host)->putJson('/api/host/availability', ['ranges' => [
            ['day_of_week' => 2, 'available_from' => '10:00', 'available_to' => '12:00'],
        ]])->assertOk()->assertJsonCount(1, 'availability');

        $this->actingAs($host)->putJson('/api/host/availability', ['ranges' => [
            ['day_of_week' => 2, 'available_from' => '10:00', 'available_to' => '10:00'],
        ]])->assertJsonValidationErrors('ranges.0.available_to');
    }

    public function test_operator_sees_brand_hosts_with_availability(): void
    {
        $assignment = $this->assignment($this->brand());
        $assignment->host->availability()->create(['day_of_week' => 1, 'available_from' => '08:00', 'available_to' => '12:00']);

        $this->actingAs($this->operator)->getJson("/api/operator/brands/{$assignment->brand_id}/hosts")
            ->assertOk()
            ->assertJsonPath('assignments.0.id', $assignment->id)
            ->assertJsonPath('assignments.0.host.availability.0.available_from', '08:00');
    }

    public function test_dashboard_counts_todays_slots(): void
    {
        $this->addSlot($this->assignment($this->brand()), today()->dayOfWeekIso, '10:00', '11:00')->assertCreated();

        $this->actingAs($this->operator)->getJson('/api/operator/dashboard')->assertJsonPath('stats.today_schedules', 1);
    }
}
