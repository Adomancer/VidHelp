<?php

namespace Tests\Feature;

use App\Models\BackupApplication;
use App\Models\BackupQuota;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class BackupTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Brand $brandA;

    private Brand $brandB;

    /** Host on brand A who needs a backup for Tuesday 14:00-16:00 */
    private HostProfile $requester;

    private ScheduleSlot $slot;

    /** Another host on brand A */
    private HostProfile $sameBrand;

    /** A host on brand B */
    private HostProfile $otherBrand;

    private const TUESDAY = '2026-10-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();

        $this->brandA = $this->brand('Brand A');
        $this->brandB = $this->brand('Brand B');

        $this->requester = $this->host();
        $this->sameBrand = $this->host();
        $this->otherBrand = $this->host();

        $assignment = $this->assign($this->requester, $this->brandA);
        $this->assign($this->sameBrand, $this->brandA);
        $this->assign($this->otherBrand, $this->brandB);

        $this->slot = $this->slotFor($assignment, 2, '14:00', '16:00');
    }

    private function brand(string $name): Brand
    {
        return Brand::create(['name' => $name, 'target_hours_per_period' => 100, 'payment_cycle_days' => 14]);
    }

    private function host(): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();

        return $user->hostProfile;
    }

    private function assign(HostProfile $host, Brand $brand): HostBrandAssignment
    {
        return HostBrandAssignment::create(['host_id' => $host->id, 'brand_id' => $brand->id, 'status' => 'active']);
    }

    private function slotFor(HostBrandAssignment $assignment, int $day, string $start, string $end): ScheduleSlot
    {
        return ScheduleSlot::create([
            'assignment_id' => $assignment->id, 'day_of_week' => $day,
            'start_time' => $start, 'end_time' => $end, 'effective_from' => '2026-09-01',
        ]);
    }

    private function request(array $overrides = [])
    {
        return $this->actingAs($this->requester->user)->postJson('/api/host/backups', $overrides + [
            'slot_id' => $this->slot->id,
            'backup_date' => self::TUESDAY,
            'reason_type' => 'permit',
            'reason' => 'Family event',
        ]);
    }

    /** An approved (open) request. */
    private function openRequest(array $overrides = []): BackupRequest
    {
        $backup = BackupRequest::findOrFail($this->request($overrides)->assertCreated()->json('request.id'));
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/approve")->assertOk();

        return $backup->fresh();
    }

    private function useQuota(HostProfile $host, int $used): void
    {
        BackupQuota::for($host->id, '2026-10')->update(['quota_used' => $used]);
    }

    public function test_host_requests_a_backup_for_one_occurrence(): void
    {
        $this->request()
            ->assertCreated()
            ->assertJsonPath('request.status', 'pending')
            ->assertJsonPath('request.backup_date', self::TUESDAY);

        $backup = BackupRequest::firstOrFail();
        $this->assertSame('2026-10-06 14:00', $backup->start_at->format('Y-m-d H:i'));
        $this->assertSame('2026-10-05 10:30', $backup->auto_open_at->format('Y-m-d H:i'));
        $this->assertSame('2026-10-06 13:30', $backup->auto_fill_at->format('Y-m-d H:i'));
    }

    public function test_request_must_match_a_real_occurrence_of_my_slot(): void
    {
        $this->request(['backup_date' => '2026-10-07'])->assertJsonValidationErrors('backup_date'); // Wednesday
        $this->request(['backup_date' => '2026-09-29'])->assertJsonValidationErrors('backup_date'); // past

        $this->actingAs($this->sameBrand->user)->postJson('/api/host/backups', [
            'slot_id' => $this->slot->id, 'backup_date' => self::TUESDAY, 'reason_type' => 'sick',
        ])->assertJsonValidationErrors('slot_id'); // not their slot

        $this->request()->assertCreated();
        $this->request()->assertJsonValidationErrors('backup_date'); // duplicate
    }

    public function test_only_approved_requests_show_as_needs_and_without_the_reason(): void
    {
        $this->request()->assertCreated();

        $this->actingAs($this->sameBrand->user)->getJson('/api/host/backups/needs')->assertJsonCount(0, 'needs');

        $backup = BackupRequest::firstOrFail();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/approve")->assertOk();

        $this->actingAs($this->sameBrand->user)->getJson('/api/host/backups/needs')
            ->assertJsonCount(1, 'needs')
            ->assertJsonPath('needs.0.same_brand', true)
            ->assertJsonPath('needs.0.ineligible_reason', null)
            ->assertJsonMissingPath('needs.0.reason');
    }

    public function test_host_live_at_that_time_cannot_apply(): void
    {
        $backup = $this->openRequest();
        $this->slotFor($this->otherBrand->assignments()->first(), 2, '15:00', '17:00');

        $this->actingAs($this->otherBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Live on Brand B (Tue 15:00-17:00).');
    }

    public function test_overnight_slot_from_the_night_before_counts_as_busy(): void
    {
        $morning = $this->slotFor($this->requester->assignments()->first(), 3, '01:00', '03:00'); // Wed 01:00
        $backup = $this->openRequest(['slot_id' => $morning->id, 'backup_date' => '2026-10-07']);
        $this->slotFor($this->otherBrand->assignments()->first(), 2, '23:00', '02:00'); // Tue night → Wed 02:00

        $this->actingAs($this->otherBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertUnprocessable();
    }

    public function test_cross_brand_quota_blocks_applying_but_same_brand_is_free(): void
    {
        $backup = $this->openRequest();
        $this->useQuota($this->otherBrand, 3);
        $this->useQuota($this->sameBrand, 3);

        $this->actingAs($this->otherBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Monthly cross-brand backup quota used (3/3).');

        $this->actingAs($this->sameBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk();
    }

    public function test_admin_picks_a_cross_brand_applicant_and_quota_is_used(): void
    {
        $backup = $this->openRequest();
        $this->actingAs($this->otherBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk();
        $this->actingAs($this->sameBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk();

        $this->actingAs($this->admin)->getJson("/api/operator/backups/{$backup->id}/applicants")
            ->assertJsonPath('applicants.0.host_id', $this->sameBrand->id); // same brand ranked first

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->otherBrand->id])
            ->assertOk()
            ->assertJsonPath('request.status', 'filled')
            ->assertJsonPath('request.counts_toward_quota', true);

        $this->assertSame(1, BackupQuota::for($this->otherBrand->id, '2026-10')->quota_used);

        $this->actingAs($this->otherBrand->user)->getJson('/api/host/backups')->assertJsonCount(1, 'covers');
    }

    public function test_dropping_a_cover_reopens_it_refunds_quota_and_flags_penalty(): void
    {
        $backup = $this->openRequest();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->otherBrand->id])->assertOk();

        $this->actingAs($this->otherBrand->user)->postJson("/api/host/backups/{$backup->id}/drop")->assertOk();

        $this->assertSame('open', $backup->fresh()->status);
        $this->assertSame(0, BackupQuota::for($this->otherBrand->id, '2026-10')->quota_used);

        $application = BackupApplication::where('applicant_host_id', $this->otherBrand->id)->firstOrFail();
        $this->assertSame('cancelled', $application->status);
        $this->assertFalse($application->penalty_applied); // points module will apply it
    }

    public function test_cover_cannot_overlap_another_cover(): void
    {
        $first = $this->openRequest();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$first->id}/assign", ['host_id' => $this->otherBrand->id])->assertOk();

        $other = $this->host();
        $otherSlot = $this->slotFor($this->assign($other, $this->brandB), 2, '15:00', '16:00');
        $second = BackupRequest::findOrFail($this->actingAs($other->user)->postJson('/api/host/backups', [
            'slot_id' => $otherSlot->id, 'backup_date' => self::TUESDAY, 'reason_type' => 'sick',
        ])->assertCreated()->json('request.id'));
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$second->id}/approve")->assertOk();

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$second->id}/assign", ['host_id' => $this->otherBrand->id])
            ->assertJsonValidationErrors('host_id');
    }

    public function test_unreviewed_request_opens_automatically_after_30_minutes(): void
    {
        $this->request()->assertCreated();

        $this->travel(29)->minutes();
        $this->artisan('backups:auto-process')->assertSuccessful();
        $this->assertSame('pending', BackupRequest::firstOrFail()->status);

        $this->travel(2)->minutes();
        $this->artisan('backups:auto-process')->assertSuccessful();
        $backup = BackupRequest::firstOrFail();
        $this->assertSame('open', $backup->status);
        $this->assertTrue($backup->auto_approved);
    }

    public function test_best_applicant_is_picked_30_minutes_before_start(): void
    {
        $backup = $this->openRequest();
        $this->actingAs($this->otherBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk(); // applied first
        $this->travel(5)->minutes();
        $this->actingAs($this->sameBrand->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk();

        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:29'));
        $this->artisan('backups:auto-process');
        $this->assertSame('open', $backup->fresh()->status);

        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:30'));
        $this->artisan('backups:auto-process');

        $backup->refresh();
        $this->assertSame('filled', $backup->status);
        $this->assertTrue($backup->auto_filled);
        $this->assertSame($this->sameBrand->id, $backup->filled_by_host_id); // same brand beats earlier cross-brand
    }

    public function test_requester_cancels_before_but_not_after_a_cover_is_picked(): void
    {
        $backup = $this->openRequest();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->sameBrand->id])->assertOk();

        $this->actingAs($this->requester->user)->postJson("/api/host/backups/{$backup->id}/cancel")->assertUnprocessable();

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/cancel")->assertOk();
        $this->assertSame('cancelled', $backup->fresh()->status);
    }

    public function test_sick_letter_is_due_then_uploaded_or_late(): void
    {
        Storage::fake('local');
        $backup = $this->openRequest(['reason_type' => 'sick']);
        $this->assertSame('due', $backup->letter_status);
        $this->assertSame('2026-10-07 14:00', $backup->letter_due_at->format('Y-m-d H:i'));

        $this->travelTo(CarbonImmutable::parse('2026-10-07 14:01'));
        $this->assertSame('late', $backup->fresh()->letter_status);

        $this->actingAs($this->requester->user)->post("/api/host/backups/{$backup->id}/letter", [
            'letter' => UploadedFile::fake()->create('surat-dokter.pdf', 100, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('request.letter_status', 'uploaded');

        $this->actingAs($this->admin)->get("/api/operator/backups/{$backup->id}/letter")->assertOk();
    }

    public function test_operator_requests_on_behalf_and_it_opens_immediately(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->postJson('/api/operator/backups', [
            'slot_id' => $this->slot->id, 'backup_date' => self::TUESDAY, 'reason_type' => 'sick',
        ])->assertCreated()->assertJsonPath('request.status', 'open');

        $this->actingAs($operator)->getJson('/api/operator/backups?status=open')->assertJsonCount(1, 'requests');
    }

    public function test_host_sees_upcoming_slot_occurrences_to_request(): void
    {
        $response = $this->actingAs($this->requester->user)->getJson('/api/host/backups/slots')->assertOk();
        $this->assertCount(2, $response->json('slots')); // Tuesdays within 14 days

        $this->request()->assertCreated();
        $this->assertCount(1, $this->actingAs($this->requester->user)->getJson('/api/host/backups/slots')->json('slots'));
    }

    public function test_cover_shows_on_both_hosts_schedules_and_the_board(): void
    {
        $backup = $this->openRequest();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->sameBrand->id])->assertOk();
        $coverName = $this->sameBrand->user->name;

        $this->actingAs($this->sameBrand->user)->getJson('/api/host/schedules')
            ->assertJsonCount(1, 'covers')
            ->assertJsonPath('covers.0.requester_name', $this->requester->user->name)
            ->assertJsonPath('covers.0.backup_date', self::TUESDAY);

        $this->actingAs($this->requester->user)->getJson('/api/host/schedules')
            ->assertJsonCount(1, 'absences')
            ->assertJsonPath('absences.0.slot_id', $this->slot->id)
            ->assertJsonPath('absences.0.status', 'filled')
            ->assertJsonPath('absences.0.filler_name', $coverName);

        $this->actingAs($this->admin)->getJson("/api/operator/schedules?brand_id={$this->brandA->id}&on=2026-10-05")
            ->assertJsonCount(1, 'backups')
            ->assertJsonPath('backups.0.filler_name', $coverName);

        // A week later that occurrence is gone from the board
        $this->actingAs($this->admin)->getJson("/api/operator/schedules?brand_id={$this->brandA->id}&on=2026-10-12")
            ->assertJsonCount(0, 'backups');
    }

    public function test_candidates_list_marks_busy_hosts(): void
    {
        $backup = $this->openRequest();
        $this->slotFor($this->otherBrand->assignments()->first(), 2, '14:30', '15:00');

        $candidates = collect($this->actingAs($this->admin)->getJson("/api/operator/backups/{$backup->id}/candidates")->json('candidates'));

        $this->assertTrue($candidates->firstWhere('host_id', $this->sameBrand->id)['eligible']);
        $this->assertFalse($candidates->firstWhere('host_id', $this->otherBrand->id)['eligible']);
        $this->assertNull($candidates->firstWhere('host_id', $this->requester->id));
    }
}
