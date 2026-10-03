<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\EventSlotClaim;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\SpecialEvent;
use App\Models\User;
use App\Models\WorkSession;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EventTest extends TestCase
{
    use RefreshDatabase;

    private User $operator;

    private Brand $brandA;

    private Brand $brandB;

    /** On Brand A, with a regular slot Tue 14:00-16:00 */
    private HostProfile $regular;

    /** Also on Brand A, no slots */
    private HostProfile $other;

    private ScheduleSlot $tuesdaySlot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        $this->operator = User::factory()->create();
        $this->operator->assignRole('operator');

        $this->brandA = Brand::create(['name' => 'Brand A', 'target_hours_per_period' => 100, 'payment_cycle_days' => 14]);
        $this->brandB = Brand::create(['name' => 'Brand B', 'target_hours_per_period' => 100, 'payment_cycle_days' => 14]);
        $this->regular = $this->host($this->brandA);
        $this->other = $this->host($this->brandA);

        $this->tuesdaySlot = ScheduleSlot::create([
            'assignment_id' => $this->regular->assignments()->first()->id,
            'day_of_week' => 2, 'start_time' => '14:00', 'end_time' => '16:00', 'effective_from' => '2026-09-01',
        ]);
    }

    private function host(Brand $brand): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();
        HostBrandAssignment::create(['host_id' => $user->hostProfile->id, 'brand_id' => $brand->id, 'status' => 'active']);

        return $user->hostProfile;
    }

    /** Brand A, Fri 9 - Sat 10 Oct, 10:00-16:00 in 2-hour blocks, 2 per host. */
    private function event(array $overrides = []): SpecialEvent
    {
        $id = $this->actingAs($this->operator)->postJson('/api/operator/events', $overrides + [
            'brand_id' => $this->brandA->id,
            'name' => 'PD 10.10',
            'start_date' => '2026-10-09',
            'end_date' => '2026-10-10',
            'daily_start_time' => '10:00',
            'daily_end_time' => '16:00',
            'block_minutes' => 120,
            'open_full_schedule' => false,
            'max_slots_per_host' => 2,
        ])->assertCreated()->json('event.id');

        return SpecialEvent::findOrFail($id);
    }

    private function claim(HostProfile $host, SpecialEvent $event, string $start)
    {
        return $this->actingAs($host->user)->postJson("/api/host/events/{$event->id}/claim", ['start_at' => $start]);
    }

    /** Tue 6 Oct 12:00-18:00 in 3-hour blocks, replacing the regular schedule. */
    private function fullEvent(): SpecialEvent
    {
        return $this->event([
            'name' => 'Flash sale', 'start_date' => '2026-10-06', 'end_date' => '2026-10-06',
            'daily_start_time' => '12:00', 'daily_end_time' => '18:00', 'block_minutes' => 180,
            'open_full_schedule' => true,
        ]);
    }

    public function test_operator_creates_an_event_with_its_block_grid(): void
    {
        $event = $this->event();

        $blocks = $this->actingAs($this->operator)->getJson("/api/operator/events/{$event->id}")->assertOk()->json('blocks');
        $this->assertCount(6, $blocks);
        $this->assertSame('free', $blocks[0]['state']);

        $this->actingAs($this->operator)->getJson('/api/operator/events')
            ->assertJsonPath('events.0.total_blocks', 6)
            ->assertJsonPath('events.0.claimed_blocks', 0);
    }

    public function test_overnight_hours_make_blocks_past_midnight(): void
    {
        $event = $this->event(['name' => 'Night', 'start_date' => '2026-10-12', 'end_date' => '2026-10-12', 'daily_start_time' => '22:00', 'daily_end_time' => '02:00']);

        $blocks = $event->blocks();
        $this->assertCount(2, $blocks);
        $this->assertSame('2026-10-13 02:00', $blocks[1][1]->format('Y-m-d H:i'));
    }

    public function test_a_brand_cannot_have_two_events_on_the_same_days(): void
    {
        $this->event();

        $this->actingAs($this->operator)->postJson('/api/operator/events', [
            'brand_id' => $this->brandA->id, 'name' => 'Double', 'start_date' => '2026-10-10', 'end_date' => '2026-10-11',
            'daily_start_time' => '10:00', 'daily_end_time' => '12:00', 'block_minutes' => 60, 'max_slots_per_host' => 1,
        ])->assertJsonValidationErrors('start_date');
    }

    public function test_first_come_first_served_with_a_limit_per_host(): void
    {
        $event = $this->event();

        $this->claim($this->other, $event, '2026-10-09 10:00')->assertCreated();
        $this->claim($this->regular, $event, '2026-10-09 10:00')->assertJsonValidationErrors('start_at');
        $this->claim($this->other, $event, '2026-10-09 12:00')->assertCreated();
        $this->claim($this->other, $event, '2026-10-10 10:00')
            ->assertJsonValidationErrors('start_at')
            ->assertJsonPath('errors.start_at.0', 'You already hold the maximum of 2 blocks for this event.');
    }

    public function test_only_hosts_of_the_brand_can_claim(): void
    {
        $event = $this->event();

        $this->claim($this->host($this->brandB), $event, '2026-10-09 10:00')->assertJsonValidationErrors('start_at');
    }

    public function test_block_must_match_the_grid(): void
    {
        $this->claim($this->other, $this->event(), '2026-10-09 11:00')
            ->assertJsonPath('errors.start_at.0', "That is not one of this event's blocks.");
    }

    public function test_event_keeping_the_regular_schedule_blocks_overlapping_hours(): void
    {
        $event = $this->event(['name' => 'Extra', 'start_date' => '2026-10-06', 'end_date' => '2026-10-06']);

        $this->claim($this->other, $event, '2026-10-06 14:00')
            ->assertJsonPath('errors.start_at.0', "Regular schedule: {$this->regular->user->name} is live then.");

        $states = collect($this->actingAs($this->other->user)->getJson('/api/host/events')->json('events.0.blocks'))->pluck('state')->all();
        $this->assertSame(['free', 'free', 'unavailable'], $states);
    }

    public function test_host_busy_on_another_brand_cannot_claim(): void
    {
        $event = $this->event();
        $assignment = HostBrandAssignment::create(['host_id' => $this->other->id, 'brand_id' => $this->brandB->id, 'status' => 'active']);
        ScheduleSlot::create(['assignment_id' => $assignment->id, 'day_of_week' => 5, 'start_time' => '11:00', 'end_time' => '13:00', 'effective_from' => '2026-09-01']);

        $this->claim($this->other, $event, '2026-10-09 10:00')->assertJsonPath('errors.start_at.0', 'Live on Brand B (Fri 11:00-13:00).');
    }

    public function test_full_schedule_event_replaces_regular_slots(): void
    {
        $this->fullEvent();

        // The Tuesday regular slot does not run: not on the Live page, no check-in, no backup
        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:30'));
        $sessions = $this->actingAs($this->regular->user)->getJson('/api/host/live')->json('sessions');
        $this->assertSame([], array_values(array_filter($sessions, fn ($s) => $s['role'] === 'own')));

        $this->actingAs($this->regular->user)->postJson('/api/host/live/check-in', [
            'slot_id' => $this->tuesdaySlot->id, 'date' => '2026-10-06',
        ])->assertJsonValidationErrors('session');

        $this->actingAs($this->regular->user)->postJson('/api/host/backups', [
            'slot_id' => $this->tuesdaySlot->id, 'backup_date' => '2026-10-06', 'reason_type' => 'sick',
        ])->assertJsonValidationErrors('backup_date');
    }

    public function test_regular_host_is_free_to_claim_during_a_full_schedule_event(): void
    {
        $event = $this->fullEvent();

        // 12:00-15:00 overlaps their (replaced) 14:00-16:00 slot
        $this->claim($this->regular, $event, '2026-10-06 12:00')->assertCreated();
    }

    public function test_claimed_block_is_checked_in_and_paid_as_event_hours(): void
    {
        $event = $this->event();
        $claimId = $this->claim($this->other, $event, '2026-10-09 10:00')->json('claim.id');

        $this->travelTo(CarbonImmutable::parse('2026-10-09 09:45'));
        $this->actingAs($this->other->user)->getJson('/api/host/live')
            ->assertJsonPath('sessions.0.role', 'event')
            ->assertJsonPath('sessions.0.event_claim_id', $claimId)
            ->assertJsonPath('sessions.0.event_name', 'PD 10.10');

        $attendanceId = $this->actingAs($this->other->user)->postJson('/api/host/live/check-in', ['event_claim_id' => $claimId])
            ->assertCreated()->json('attendance.id');
        $this->actingAs($this->other->user)->postJson('/api/host/live/check-in', ['event_claim_id' => $claimId])
            ->assertJsonValidationErrors('session');

        $this->travelTo(CarbonImmutable::parse('2026-10-09 12:00'));
        $this->actingAs($this->other->user)->postJson("/api/host/live/{$attendanceId}/check-out")->assertOk();
        $this->actingAs($this->other->user)->postJson("/api/host/live/{$attendanceId}/report", ['session_count' => 1, 'duration_hours' => 2])
            ->assertJsonPath('report.status', 'approved');

        $session = WorkSession::firstOrFail();
        $this->assertSame('event', $session->session_type);
        $this->assertSame($this->brandA->id, $session->brand_id);
        $this->assertNull(Attendance::firstOrFail()->slot_id);
    }

    public function test_host_releases_a_block_before_it_starts_but_not_after_check_in(): void
    {
        $event = $this->event();
        $keep = $this->claim($this->other, $event, '2026-10-09 10:00')->json('claim.id');
        $release = $this->claim($this->other, $event, '2026-10-09 12:00')->json('claim.id');

        $this->actingAs($this->other->user)->postJson("/api/host/event-claims/{$release}/cancel")->assertOk();
        $this->claim($this->regular, $event, '2026-10-09 12:00')->assertCreated(); // free again

        $this->travelTo(CarbonImmutable::parse('2026-10-09 09:50'));
        $this->actingAs($this->other->user)->postJson('/api/host/live/check-in', ['event_claim_id' => $keep])->assertCreated();
        $this->actingAs($this->operator)->postJson("/api/operator/event-claims/{$keep}/release")->assertJsonValidationErrors('start_at');
    }

    public function test_operator_assigns_and_takes_over_a_block(): void
    {
        $event = $this->event(['max_slots_per_host' => 1]);
        $firstId = $this->claim($this->other, $event, '2026-10-09 10:00')->json('claim.id');
        $this->claim($this->regular, $event, '2026-10-09 12:00')->assertCreated();

        // Past the host's limit and over someone else's claim: allowed for an operator
        $this->actingAs($this->operator)->postJson("/api/operator/events/{$event->id}/assign", [
            'start_at' => '2026-10-09 10:00', 'host_id' => $this->regular->id,
        ])->assertCreated();

        $this->assertSame('overridden', EventSlotClaim::findOrFail($firstId)->status);
        $this->assertSame(2, EventSlotClaim::active()->where('host_id', $this->regular->id)->count());
    }

    public function test_cancelling_an_event_releases_every_block(): void
    {
        $event = $this->event();
        $this->claim($this->other, $event, '2026-10-09 10:00')->assertCreated();

        $this->actingAs($this->operator)->postJson("/api/operator/events/{$event->id}/cancel")->assertOk();

        $this->assertSame(0, EventSlotClaim::active()->count());
        $this->claim($this->regular, $event, '2026-10-09 12:00')->assertJsonPath('errors.start_at.0', 'This event was cancelled.');
    }

    public function test_host_sees_their_blocks_and_others(): void
    {
        $event = $this->event();
        $this->claim($this->other, $event, '2026-10-09 10:00')->assertCreated();
        $this->claim($this->regular, $event, '2026-10-09 12:00')->assertCreated();

        $this->actingAs($this->other->user)->getJson('/api/host/events')
            ->assertJsonPath('events.0.my_claims', 1)
            ->assertJsonPath('events.0.blocks.0.state', 'mine')
            ->assertJsonPath('events.0.blocks.1.state', 'taken')
            ->assertJsonPath('events.0.blocks.1.claim.host_name', $this->regular->user->name);
    }

    public function test_host_only_sees_events_of_their_brands(): void
    {
        $this->event();
        $elsewhere = $this->host($this->brandB);

        $this->actingAs($elsewhere->user)->getJson('/api/host/events')
            ->assertOk()
            ->assertJsonCount(0, 'events')
            ->assertJsonPath('my_brands', ['Brand B']);

        $this->actingAs($this->other->user)->getJson('/api/host/events')
            ->assertJsonCount(1, 'events')
            ->assertJsonPath('my_brands', ['Brand A']);
    }

    public function test_event_block_makes_the_host_busy_for_backups(): void
    {
        $event = $this->event(['name' => 'Tuesday', 'start_date' => '2026-10-06', 'end_date' => '2026-10-06', 'daily_end_time' => '14:00']);
        $this->claim($this->other, $event, '2026-10-06 12:00')->assertCreated();

        $backup = BackupRequest::create([
            'slot_id' => $this->tuesdaySlot->id, 'brand_id' => $this->brandA->id, 'requesting_host_id' => $this->regular->id,
            'backup_date' => '2026-10-06', 'start_at' => '2026-10-06 13:00', 'end_at' => '2026-10-06 16:00',
            'reason_type' => 'sick', 'status' => 'open', 'auto_fill_at' => '2026-10-06 12:30',
        ]);

        $this->actingAs($this->other->user)->postJson("/api/host/backups/{$backup->id}/apply")
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Booked for Tuesday at that time.');
    }

    public function test_schedules_show_event_blocks_and_replaced_days(): void
    {
        $event = $this->fullEvent();
        $this->claim($this->regular, $event, '2026-10-06 15:00')->assertCreated();

        $this->actingAs($this->regular->user)->getJson('/api/host/schedules')
            ->assertJsonPath('event_claims.0.event_name', 'Flash sale')
            ->assertJsonPath('replacing_events.0.name', 'Flash sale');

        $this->actingAs($this->operator)->getJson("/api/operator/schedules?brand_id={$this->brandA->id}")
            ->assertJsonPath('replacing_events.0.id', $event->id);
    }
}
