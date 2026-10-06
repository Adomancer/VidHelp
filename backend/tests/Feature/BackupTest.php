<?php

namespace Tests\Feature;

use App\Models\AppNotification;
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

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday, 28 hours before the slot
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

    private function assign(HostProfile $host, Brand $brand, string $status = 'active'): HostBrandAssignment
    {
        return HostBrandAssignment::create(['host_id' => $host->id, 'brand_id' => $brand->id, 'status' => $status]);
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

    /** A request on the board (open to every host). */
    private function openRequest(array $overrides = []): BackupRequest
    {
        return BackupRequest::findOrFail($this->request($overrides)->assertCreated()->json('request.id'));
    }

    private function apply(HostProfile $host, BackupRequest $backup)
    {
        return $this->actingAs($host->user)->postJson("/api/host/backups/{$backup->id}/apply");
    }

    private function useQuota(HostProfile $host, int $used): void
    {
        BackupQuota::for($host->id, '2026-10')->update(['quota_used' => $used]);
    }

    private function notified(User $user, string $type): bool
    {
        return AppNotification::where('user_id', $user->id)->where('channel', 'web')->where('type', $type)->exists();
    }

    public function test_host_request_goes_straight_to_the_board(): void
    {
        $this->request()
            ->assertCreated()
            ->assertJsonPath('request.status', 'open')
            ->assertJsonPath('request.request_type', 'open')
            ->assertJsonPath('request.backup_date', self::TUESDAY);

        $backup = BackupRequest::firstOrFail();
        $this->assertSame('2026-10-06 14:00', $backup->start_at->format('Y-m-d H:i'));
        $this->assertSame('2026-10-06 13:30', $backup->auto_fill_at->format('Y-m-d H:i'));

        $this->actingAs($this->sameBrand->user)->getJson('/api/host/backups/needs')
            ->assertJsonCount(1, 'needs')
            ->assertJsonPath('needs.0.same_brand', true)
            ->assertJsonPath('needs.0.ineligible_reason', null)
            ->assertJsonMissingPath('needs.0.reason');
        $this->assertTrue($this->notified($this->sameBrand->user, 'backup_opened'));
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

    public function test_host_must_request_at_least_a_day_ahead_but_staff_can_any_time(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-05 14:01')); // 23h59m before the slot

        $this->request()->assertJsonValidationErrors(['backup_date' => 'paling lambat 24 jam']);
        $slots = $this->actingAs($this->requester->user)->getJson('/api/host/backups/slots')->json('slots');
        $this->assertSame(['2026-10-13'], array_column($slots, 'date')); // next Tuesday is still far enough ahead

        $this->actingAs($this->admin)->postJson('/api/operator/backups', [
            'slot_id' => $this->slot->id, 'backup_date' => self::TUESDAY, 'reason_type' => 'sick',
        ])->assertCreated()->assertJsonPath('request.status', 'open');
    }

    public function test_host_live_at_that_time_cannot_apply(): void
    {
        $backup = $this->openRequest();
        $this->slotFor($this->otherBrand->assignments()->first(), 2, '15:00', '17:00');

        $this->apply($this->otherBrand, $backup)
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Live di Brand B (Sel 15:00-17:00).');
    }

    public function test_overnight_slot_from_the_night_before_counts_as_busy(): void
    {
        $morning = $this->slotFor($this->requester->assignments()->first(), 3, '01:00', '03:00'); // Wed 01:00
        $backup = $this->openRequest(['slot_id' => $morning->id, 'backup_date' => '2026-10-07']);
        $this->slotFor($this->otherBrand->assignments()->first(), 2, '23:00', '02:00'); // Tue night → Wed 02:00

        $this->apply($this->otherBrand, $backup)->assertUnprocessable();
    }

    public function test_host_banned_from_the_brand_cannot_cover_it(): void
    {
        $backup = $this->openRequest();
        $this->assign($this->otherBrand, $this->brandA, 'banned');

        $this->apply($this->otherBrand, $backup)
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Diblokir dari Brand A.');

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->otherBrand->id])
            ->assertJsonValidationErrors('host_id');
    }

    public function test_cross_brand_quota_blocks_applying_but_same_brand_is_free(): void
    {
        $backup = $this->openRequest();
        $this->useQuota($this->otherBrand, 3);
        $this->useQuota($this->sameBrand, 3);

        $this->apply($this->otherBrand, $backup)
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Kuota backup lintas brand bulan ini sudah habis (3/3).');

        $this->apply($this->sameBrand, $backup)->assertOk();
    }

    public function test_first_applicant_makes_it_pending_and_alerts_staff_until_withdrawn(): void
    {
        $backup = $this->openRequest();

        $this->apply($this->sameBrand, $backup)->assertOk();
        $this->assertSame('pending', $backup->fresh()->status);
        $this->assertTrue($this->notified($this->admin, 'backup_applied'));

        // Still on the board: others may apply until the admin decides
        $this->actingAs($this->otherBrand->user)->getJson('/api/host/backups/needs')->assertJsonCount(1, 'needs');

        $this->actingAs($this->sameBrand->user)->postJson("/api/host/backups/{$backup->id}/withdraw")->assertOk();
        $this->assertSame('open', $backup->fresh()->status);
    }

    public function test_rejecting_the_only_applicant_reopens_the_request(): void
    {
        $backup = $this->openRequest();
        $this->apply($this->sameBrand, $backup)->assertOk();
        $this->apply($this->otherBrand, $backup)->assertOk();

        $reject = fn (HostProfile $host) => $this->actingAs($this->admin)
            ->postJson("/api/operator/backups/{$backup->id}/reject-applicant", ['host_id' => $host->id]);

        $reject($this->sameBrand)->assertOk();
        $this->assertSame('pending', $backup->fresh()->status); // brand B host still waits
        $this->assertTrue($this->notified($this->sameBrand->user, 'backup_not_picked'));

        $reject($this->otherBrand)->assertOk();
        $this->assertSame('open', $backup->fresh()->status);
        $this->assertTrue($this->notified($this->requester->user, 'backup_reopened'));

        $reject($this->otherBrand)->assertUnprocessable(); // nothing left to reject

        // The admin's "no" sticks: a rejected host can't apply to this request again
        $this->apply($this->sameBrand, $backup)
            ->assertUnprocessable()
            ->assertJsonPath('errors.backup.0', 'Admin sudah menolak tawaranmu untuk backup ini.');
        $this->actingAs($this->sameBrand->user)->getJson('/api/host/backups/needs')
            ->assertJsonPath('needs.0.ineligible_reason', 'Admin sudah menolak tawaranmu untuk backup ini.');
    }

    public function test_rejected_host_who_tries_again_is_not_auto_approved(): void
    {
        $backup = $this->openRequest();
        $this->apply($this->sameBrand, $backup)->assertOk();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/reject-applicant", ['host_id' => $this->sameBrand->id])->assertOk();
        $this->apply($this->sameBrand, $backup)->assertUnprocessable();

        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:30'));
        $this->artisan('backups:auto-process');

        $this->assertSame('open', $backup->fresh()->status);

        // The admin can still change their mind and assign them directly
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->sameBrand->id])->assertOk();
    }

    public function test_other_applicants_hear_they_were_not_picked_and_stay_on_standby(): void
    {
        $backup = $this->openRequest();
        $this->apply($this->sameBrand, $backup)->assertOk();
        $this->apply($this->otherBrand, $backup)->assertOk();

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->sameBrand->id])->assertOk();

        $this->assertTrue($this->notified($this->otherBrand->user, 'backup_not_picked'));
        $this->assertFalse($this->notified($this->sameBrand->user, 'backup_not_picked'));

        // Standby: if the cover drops out, the other applicant is waiting again
        $this->actingAs($this->sameBrand->user)->postJson("/api/host/backups/{$backup->id}/drop")->assertOk();
        $this->assertSame('pending', $backup->fresh()->status);
    }

    public function test_cancelling_a_covered_request_tells_the_cover_and_anyone_waiting(): void
    {
        $backup = $this->openRequest();
        $this->apply($this->sameBrand, $backup)->assertOk();
        $this->apply($this->otherBrand, $backup)->assertOk();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->sameBrand->id])->assertOk();

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/cancel")->assertOk();

        $this->assertTrue($this->notified($this->sameBrand->user, 'backup_cancelled'));
        $this->assertTrue($this->notified($this->otherBrand->user, 'backup_cancelled'));
        $this->assertFalse($this->notified($this->requester->user, 'backup_cancelled'));
    }

    public function test_host_cannot_apply_to_two_backups_at_the_same_time(): void
    {
        $first = $this->openRequest();

        $other = $this->host();
        $otherSlot = $this->slotFor($this->assign($other, $this->brandB), 2, '15:00', '16:00');
        $second = BackupRequest::findOrFail($this->actingAs($other->user)->postJson('/api/host/backups', [
            'slot_id' => $otherSlot->id, 'backup_date' => self::TUESDAY, 'reason_type' => 'sick',
        ])->assertCreated()->json('request.id'));

        $this->apply($this->sameBrand, $first)->assertOk();
        $this->apply($this->sameBrand, $second)
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Kamu sudah mendaftar menggantikan di Brand A pada waktu yang sama. Tarik diri dari yang itu dulu.');
    }

    public function test_applications_close_when_the_slot_starts(): void
    {
        $backup = $this->openRequest();
        $this->travelTo(CarbonImmutable::parse('2026-10-06 14:00'));

        $this->apply($this->sameBrand, $backup)->assertUnprocessable()->assertJsonPath('message', 'Backup ini sudah tidak dibuka.');
        $this->actingAs($this->sameBrand->user)->getJson('/api/host/backups/needs')->assertJsonCount(0, 'needs');
    }

    public function test_direct_request_names_two_to_five_hosts_who_are_free(): void
    {
        $direct = fn (array $ids) => $this->request(['request_type' => 'direct', 'host_ids' => $ids]);

        $direct([$this->sameBrand->id])->assertJsonValidationErrors(['host_ids' => 'minimal 2']);
        $direct([])->assertJsonValidationErrors('host_ids');
        $direct(collect(range(1, 6))->map(fn () => $this->host()->id)->all())->assertJsonValidationErrors(['host_ids' => 'maksimal 5']);
        $direct([$this->sameBrand->id, $this->requester->id])->assertJsonValidationErrors(['host_ids' => 'permintaanmu sendiri']);

        $this->slotFor($this->otherBrand->assignments()->first(), 2, '15:00', '17:00');
        $direct([$this->sameBrand->id, $this->otherBrand->id])
            ->assertJsonValidationErrors(['host_ids' => "{$this->otherBrand->user->name} tidak bisa menggantikan: Live di Brand B"]);

        $this->assertSame(0, BackupRequest::count());
    }

    public function test_only_nominees_can_apply_to_a_direct_request(): void
    {
        $nominee = $this->host();
        $this->assign($nominee, $this->brandB);

        $backup = BackupRequest::findOrFail($this->request([
            'request_type' => 'direct', 'host_ids' => [$this->sameBrand->id, $nominee->id],
        ])->assertCreated()->assertJsonPath('request.request_type', 'direct')->json('request.id'));

        $this->assertTrue($this->notified($nominee->user, 'backup_asked'));
        $this->assertFalse($this->notified($this->otherBrand->user, 'backup_opened'));

        // Everyone sees it on the board; only nominees can take it
        $this->actingAs($this->otherBrand->user)->getJson('/api/host/backups/needs')
            ->assertJsonPath('needs.0.request_type', 'direct')
            ->assertJsonPath('needs.0.asked_me', false)
            ->assertJsonPath('needs.0.ineligible_reason', "Hanya host yang diminta {$this->requester->user->name} yang bisa mengambil ini.");
        $this->apply($this->otherBrand, $backup)->assertUnprocessable();

        $this->actingAs($nominee->user)->getJson('/api/host/backups/needs')->assertJsonPath('needs.0.asked_me', true);
        $this->apply($nominee, $backup)->assertOk();

        // An admin can still assign someone else in an emergency
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->otherBrand->id])->assertOk();
    }

    public function test_host_sees_who_is_free_to_name(): void
    {
        $this->slotFor($this->otherBrand->assignments()->first(), 2, '15:00', '17:00');

        $candidates = collect($this->actingAs($this->requester->user)->getJson('/api/host/backups/candidates?'.http_build_query([
            'slot_id' => $this->slot->id, 'backup_date' => self::TUESDAY,
        ]))->assertOk()->json('candidates'));

        $this->assertTrue($candidates->firstWhere('host_id', $this->sameBrand->id)['eligible']);
        $this->assertFalse($candidates->firstWhere('host_id', $this->otherBrand->id)['eligible']);
        $this->assertNull($candidates->firstWhere('host_id', $this->requester->id));
        $this->assertArrayNotHasKey('rating', $candidates->first());

        // Another host's reason (here: their own slot then) stays private
        $this->assertSame('Tidak tersedia', $candidates->firstWhere('host_id', $this->otherBrand->id)['ineligible_reason']);
        $this->assertNull($candidates->firstWhere('host_id', $this->sameBrand->id)['ineligible_reason']);
    }

    public function test_admin_approves_a_cross_brand_applicant_and_quota_is_used(): void
    {
        $backup = $this->openRequest();
        $this->apply($this->otherBrand, $backup)->assertOk();
        $this->apply($this->sameBrand, $backup)->assertOk();

        $this->actingAs($this->admin)->getJson("/api/operator/backups/{$backup->id}/applicants")
            ->assertJsonPath('applicants.0.host_id', $this->sameBrand->id); // same brand ranked first

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->otherBrand->id])
            ->assertOk()
            ->assertJsonPath('request.status', 'filled')
            ->assertJsonPath('request.approved_by', $this->admin->id)
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
        $this->assertTrue($application->penalty_applied); // processed; the deduction itself is tested in PointsTest
    }

    public function test_dropped_cover_goes_back_to_pending_when_others_still_wait(): void
    {
        $backup = $this->openRequest();
        $this->apply($this->sameBrand, $backup)->assertOk();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->otherBrand->id])->assertOk();

        $this->actingAs($this->otherBrand->user)->postJson("/api/host/backups/{$backup->id}/drop")->assertOk();

        $this->assertSame('pending', $backup->fresh()->status);
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

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$second->id}/assign", ['host_id' => $this->otherBrand->id])
            ->assertJsonValidationErrors('host_id');
    }

    public function test_best_applicant_is_approved_30_minutes_before_start_if_nobody_decided(): void
    {
        $backup = $this->openRequest();
        $this->apply($this->otherBrand, $backup)->assertOk(); // applied first
        $this->travel(5)->minutes();
        $this->apply($this->sameBrand, $backup)->assertOk();

        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:29'));
        $this->artisan('backups:auto-process');
        $this->assertSame('pending', $backup->fresh()->status);

        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:30'));
        $this->artisan('backups:auto-process');

        $backup->refresh();
        $this->assertSame('filled', $backup->status);
        $this->assertTrue($backup->auto_filled);
        $this->assertNull($backup->approved_by);
        $this->assertSame($this->sameBrand->id, $backup->filled_by_host_id); // same brand beats earlier cross-brand
    }

    public function test_rejected_applicant_is_never_auto_approved(): void
    {
        $backup = $this->openRequest();
        $this->apply($this->sameBrand, $backup)->assertOk();
        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/reject-applicant", ['host_id' => $this->sameBrand->id])->assertOk();

        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:30'));
        $this->artisan('backups:auto-process');

        $this->assertSame('open', $backup->fresh()->status);
        $this->assertNotNull($backup->fresh()->no_cover_alerted_at);
    }

    public function test_requester_cancels_before_but_not_after_a_cover_is_approved(): void
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

    public function test_sick_letter_can_come_with_the_request(): void
    {
        Storage::fake('local');

        $this->actingAs($this->requester->user)->post('/api/host/backups', [
            'slot_id' => $this->slot->id,
            'backup_date' => self::TUESDAY,
            'reason_type' => 'sick',
            'request_type' => 'direct',
            'host_ids' => [$this->sameBrand->id, $this->otherBrand->id],
            'letter' => UploadedFile::fake()->create('surat-dokter.pdf', 100, 'application/pdf'),
        ], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('request.letter_status', 'uploaded')
            ->assertJsonCount(2, 'request.nominees');
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

    public function test_operator_picks_a_cover_straight_from_the_schedule(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $candidates = collect($this->actingAs($operator)
            ->getJson("/api/operator/backups/candidates?slot_id={$this->slot->id}&backup_date=".self::TUESDAY)
            ->assertOk()
            ->json('candidates'));
        $this->assertTrue($candidates->firstWhere('host_id', $this->sameBrand->id)['eligible']);
        $this->assertNull($candidates->firstWhere('host_id', $this->requester->id));

        $this->actingAs($operator)->postJson('/api/operator/backups', [
            'slot_id' => $this->slot->id, 'backup_date' => self::TUESDAY, 'reason_type' => 'permit', 'host_id' => $this->sameBrand->id,
        ])
            ->assertCreated()
            ->assertJsonPath('request.status', 'filled')
            ->assertJsonPath('request.filled_by_host_id', $this->sameBrand->id);
    }

    public function test_operator_cannot_pick_a_busy_cover(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');
        $this->slotFor(HostBrandAssignment::where('host_id', $this->otherBrand->id)->firstOrFail(), 2, '15:00', '17:00');

        $this->actingAs($operator)->postJson('/api/operator/backups', [
            'slot_id' => $this->slot->id, 'backup_date' => self::TUESDAY, 'reason_type' => 'permit', 'host_id' => $this->otherBrand->id,
        ])->assertJsonValidationErrors('host_id');

        $this->assertSame(0, BackupRequest::count());
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
