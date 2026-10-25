<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class BrandAssignmentTest extends TestCase
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

    private function host(): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();

        return $user->hostProfile;
    }

    private function brand(array $attributes = []): Brand
    {
        return Brand::create($attributes + ['name' => 'Brand '.uniqid(), 'target_hours_per_period' => 100]);
    }

    public function test_admin_creates_and_updates_brands(): void
    {
        $id = $this->actingAs($this->admin)->postJson('/api/admin/brands', [
            'name' => 'Skintific',
            'is_obs' => true,
            'target_hours_per_period' => 120,
        ])->assertCreated()->json('brand.id');

        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$id}", ['status' => 'inactive'])
            ->assertOk()
            ->assertJsonPath('brand.status', 'inactive');

        $this->actingAs($this->admin)->postJson('/api/admin/brands', [
            'name' => 'Skintific', 'target_hours_per_period' => 1,
        ])->assertJsonValidationErrors('name');
    }

    public function test_operator_can_list_but_not_create_brands(): void
    {
        $this->brand(['name' => 'Wardah']);

        $this->actingAs($this->operator)->getJson('/api/operator/brands')
            ->assertOk()
            ->assertJsonPath('brands.0.name', 'Wardah');

        $this->actingAs($this->operator)->postJson('/api/admin/brands', [
            'name' => 'X', 'target_hours_per_period' => 1,
        ])->assertForbidden();
    }

    public function test_operator_assigns_host_once_per_brand(): void
    {
        $host = $this->host();
        $brand = $this->brand();

        $this->actingAs($this->operator)->postJson('/api/operator/assignments', [
            'host_id' => $host->id,
            'brand_id' => $brand->id,
        ])->assertCreated()->assertJsonPath('assignment.status', 'active');

        $this->actingAs($this->operator)->postJson('/api/operator/assignments', [
            'host_id' => $host->id,
            'brand_id' => $brand->id,
        ])->assertJsonValidationErrors('brand_id');
    }

    public function test_cannot_assign_to_inactive_brand(): void
    {
        $this->actingAs($this->operator)->postJson('/api/operator/assignments', [
            'host_id' => $this->host()->id,
            'brand_id' => $this->brand(['status' => 'inactive'])->id,
        ])->assertJsonValidationErrors('brand_id');
    }

    public function test_brand_has_only_one_leader(): void
    {
        $brand = $this->brand();
        [$first, $second] = [$this->host(), $this->host()];

        $firstId = $this->actingAs($this->operator)->postJson('/api/operator/assignments', [
            'host_id' => $first->id, 'brand_id' => $brand->id, 'is_leader' => true,
        ])->assertCreated()->assertJsonPath('assignment.is_leader', true)->json('assignment.id');

        $this->actingAs($this->operator)->postJson('/api/operator/assignments', [
            'host_id' => $second->id, 'brand_id' => $brand->id, 'is_leader' => true,
        ])->assertCreated();

        $this->assertFalse((bool) $first->assignments()->find($firstId)->is_leader);

        $this->actingAs($this->operator)->getJson('/api/operator/brands')
            ->assertJsonPath('brands.0.leader.name', $second->user->name)
            ->assertJsonPath('brands.0.active_hosts_count', 2);
    }

    public function test_deactivating_an_assignment_removes_leadership(): void
    {
        $brand = $this->brand();
        $id = $this->actingAs($this->operator)->postJson('/api/operator/assignments', [
            'host_id' => $this->host()->id, 'brand_id' => $brand->id, 'is_leader' => true,
        ])->json('assignment.id');

        $this->actingAs($this->operator)->putJson("/api/operator/assignments/{$id}", ['status' => 'inactive'])
            ->assertOk()
            ->assertJsonPath('assignment.is_leader', false);
    }

    public function test_inactive_hosts_cannot_be_assigned(): void
    {
        $host = $this->host();
        $host->update(['status' => 'archived']);

        $this->actingAs($this->operator)->postJson('/api/operator/assignments', [
            'host_id' => $host->id, 'brand_id' => $this->brand()->id,
        ])->assertJsonValidationErrors(['host_id' => 'Pilih host yang aktif.']);
    }

    public function test_banning_a_host_from_a_brand_gives_up_their_backups_there(): void
    {
        $brand = $this->brand();
        $otherBrand = $this->brand();
        $host = $this->host();
        $banned = $host->assignments()->create(['brand_id' => $brand->id, 'status' => 'active']);
        $elsewhere = $host->assignments()->create(['brand_id' => $otherBrand->id, 'status' => 'active']);
        $requester = $this->host();
        $start = today()->addWeek()->setTime(19, 0);
        $backup = fn (Brand $on, HostProfile $for, ?HostProfile $cover) => BackupRequest::create([
            'slot_id' => ScheduleSlot::create([
                'assignment_id' => $for->assignments()->firstOrCreate(['brand_id' => $on->id], ['status' => 'active'])->id,
                'day_of_week' => $start->dayOfWeekIso, 'start_time' => '19:00', 'end_time' => '21:00', 'effective_from' => today()->subMonth(),
            ])->id,
            'brand_id' => $on->id, 'requesting_host_id' => $for->id,
            'backup_date' => $start->toDateString(), 'start_at' => $start, 'end_at' => $start->copy()->addHours(2),
            'reason_type' => 'permit', 'status' => $cover ? 'filled' : 'open', 'filled_by_host_id' => $cover?->id,
            'auto_fill_at' => $start->copy()->subMinutes(30),
        ]);
        $covering = $backup($brand, $requester, $host);         // they cover someone on the brand
        $own = $backup($brand, $host, null);                    // they asked for a cover there
        $coveringElsewhere = $backup($otherBrand, $requester, $host);

        $this->actingAs($this->operator)->putJson("/api/operator/assignments/{$banned->id}", ['status' => 'banned'])->assertOk();

        $this->assertSame('open', $covering->fresh()->status);
        $this->assertNull($covering->fresh()->filled_by_host_id);
        $this->assertSame('cancelled', $own->fresh()->status);
        $this->assertSame('filled', $coveringElsewhere->fresh()->status);
        $this->assertSame('active', $elsewhere->fresh()->status);
    }

    public function test_host_list_filters_by_brand(): void
    {
        $brand = $this->brand();
        $assigned = $this->host();
        $this->host(); // not assigned
        $assigned->assignments()->create(['brand_id' => $brand->id, 'status' => 'active']);

        $this->actingAs($this->operator)->getJson("/api/operator/hosts?brand_id={$brand->id}")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $assigned->id);
    }

    public function test_host_list_searches_several_names_and_picked_hosts_at_once(): void
    {
        $ayu = $this->host();
        $ayu->user->update(['name' => 'Ayu Lestari']);
        $budi = $this->host();
        $budi->user->update(['name' => 'Budi Santoso']);
        $picked = $this->host();
        $this->host(); // matches nothing

        $query = http_build_query(['search' => ['ayu', 'santoso'], 'host_ids' => [$picked->id]]);

        $ids = collect($this->actingAs($this->operator)->getJson("/api/operator/hosts?{$query}")->assertOk()->json('data'))->pluck('id');
        $this->assertEqualsCanonicalizing([$ayu->id, $budi->id, $picked->id], $ids->all());

        // A single search text still works as before
        $this->actingAs($this->operator)->getJson('/api/operator/hosts?search=lestari')
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $ayu->id);
    }

    public function test_operator_exports_every_filtered_host_to_excel(): void
    {
        $brand = $this->brand(['name' => 'Wardah']);
        $other = $this->brand(['name' => 'Emina']);
        $assigned = $this->host();
        $assigned->update(['phone' => '08123456789']);
        $assigned->assignments()->create(['brand_id' => $brand->id, 'status' => 'active', 'is_leader' => true]);
        $assigned->assignments()->create(['brand_id' => $other->id, 'status' => 'banned']);
        $this->host(); // not assigned

        $sheets = $this->xlsxSheets(
            $this->actingAs($this->operator)->get("/api/operator/hosts/export?brand_id={$brand->id}")
                ->assertOk()
                ->assertDownload('hosts-'.today()->toDateString().'.xlsx')
        );

        $this->assertSame(['Ringkasan', 'Daftar Host'], array_keys($sheets));
        $this->assertSame(1, $this->xlsxValue($sheets['Ringkasan'], 'Total host'));

        $hosts = $this->xlsxTable($sheets['Daftar Host'], 'No');
        // Guardians' numbers are someone else's personal data: not in an operator's file
        $this->assertSame(
            ['No', 'Nama', 'Email', 'No. HP', 'Status', 'Level tarif', 'Tarif per jam', 'Tanggal bergabung', 'Masa kerja (bulan)', 'Brand aktif', 'Leader di'],
            $hosts[0],
        );
        $this->assertCount(2, $hosts);
        $this->assertSame($assigned->user->email, $hosts[1][2]);
        $this->assertSame('08123456789', $hosts[1][3]);
        $this->assertSame('Aktif', $hosts[1][4]);
        // The banned assignment (Emina) isn't an active brand
        $this->assertSame('Wardah', $hosts[1][9]);
        $this->assertSame('Wardah', $hosts[1][10]);
        $this->assertDatabaseHas('audit_logs', ['user_id' => $this->operator->id, 'action' => 'hosts_exported']);
    }

    public function test_admin_host_export_has_guardians_numbers_and_is_audited(): void
    {
        $this->host()->update(['guardian_phone' => '08987654321']);

        $hosts = $this->xlsxTable($this->xlsxSheets($this->actingAs($this->admin)->get('/api/operator/hosts/export')->assertOk())['Daftar Host'], 'No');

        $this->assertSame('No. HP wali', $hosts[0][4]);
        $this->assertSame('08987654321', $hosts[1][4]);
        $log = AuditLog::where('action', 'hosts_exported')->firstOrFail();
        $this->assertSame($this->admin->id, $log->user_id);
        $this->assertSame(1, $log->new_value['count']);
        $this->assertTrue($log->new_value['guardian_phones']);
    }

    public function test_host_export_writes_formula_like_names_as_plain_text(): void
    {
        $host = $this->host();
        $host->user->update(['name' => '=HYPERLINK("http://evil.test","Click")']);

        $response = $this->actingAs($this->operator)->get('/api/operator/hosts/export')->assertOk();
        $zip = new \ZipArchive;
        $zip->open($response->baseResponse->getFile()->getPathname());
        $listXml = $zip->getFromName('xl/worksheets/sheet2.xml'); // "Daftar Host" (no total row, so no formulas)
        $zip->close();

        $this->assertStringNotContainsString('<f>', $listXml);
        $this->assertSame('=HYPERLINK("http://evil.test","Click")', $this->xlsxTable($this->xlsxSheets($response)['Daftar Host'], 'No')[1][1]);
    }

    public function test_host_cannot_use_operator_routes(): void
    {
        $host = $this->host();

        $this->actingAs($host->user)->getJson('/api/operator/hosts')->assertForbidden();
        $this->actingAs($host->user)->postJson('/api/operator/assignments', [])->assertForbidden();
    }

    public function test_operator_and_admin_save_product_knowledge_text(): void
    {
        $brand = $this->brand(['name' => 'Skintific']);

        $this->actingAs($this->operator)->putJson("/api/operator/brands/{$brand->id}/knowledge", ['product_knowledge' => "Serum 5X Ceramide\nHarga Rp 129.000"])
            ->assertOk()
            ->assertJsonPath('brand.product_knowledge', '<p>Serum 5X Ceramide<br />Harga Rp 129.000</p>');

        // Formatting pasted from a document stays; scripts don't
        $this->actingAs($this->operator)->putJson("/api/operator/brands/{$brand->id}/knowledge", ['product_knowledge' => '<h2>Promo</h2><p><strong>Diskon</strong><script>alert(1)</script></p>'])
            ->assertOk()
            ->assertJsonPath('brand.product_knowledge', '<h2>Promo</h2><p><strong>Diskon</strong></p>');

        $this->actingAs($this->admin)->putJson("/api/operator/brands/{$brand->id}/knowledge", ['product_knowledge' => null])
            ->assertOk()
            ->assertJsonPath('brand.product_knowledge', null);

        $host = $this->host();
        $this->actingAs($host->user)->putJson("/api/operator/brands/{$brand->id}/knowledge", ['product_knowledge' => 'x'])->assertForbidden();
    }

    public function test_operator_uploads_and_removes_product_knowledge_files(): void
    {
        Storage::fake('local');
        $brand = $this->brand();
        $url = "/api/operator/brands/{$brand->id}/knowledge/files";

        $pdf = $this->actingAs($this->operator)->post($url, ['file' => UploadedFile::fake()->create('katalog.pdf', 500, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('file.original_name', 'katalog.pdf')
            ->assertJsonMissingPath('file.file_path')
            ->json('file.id');
        $this->actingAs($this->operator)->post($url, ['file' => UploadedFile::fake()->create('wa.png', 20, 'image/png')], ['Accept' => 'application/json'])->assertCreated();
        $this->actingAs($this->operator)->post($url, ['file' => UploadedFile::fake()->create('pk.docx', 50, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')], ['Accept' => 'application/json'])->assertCreated();

        // Other file types and files over 20 MB are refused
        $this->actingAs($this->operator)->post($url, ['file' => UploadedFile::fake()->create('virus.exe', 10)], ['Accept' => 'application/json'])->assertJsonValidationErrors('file');
        $this->actingAs($this->operator)->post($url, ['file' => UploadedFile::fake()->create('big.pdf', 21000, 'application/pdf')], ['Accept' => 'application/json'])->assertJsonValidationErrors('file');

        $this->actingAs($this->operator)->getJson("/api/operator/brands/{$brand->id}/knowledge")->assertOk()->assertJsonCount(3, 'files');
        $this->actingAs($this->operator)->get("{$url}/{$pdf}")->assertOk();

        $path = $brand->attachments()->findOrFail($pdf)->file_path;
        $this->actingAs($this->operator)->deleteJson("{$url}/{$pdf}")->assertOk();
        Storage::disk('local')->assertMissing($path);
        $this->assertSame(2, $brand->attachments()->count());

        // A file of another brand can't be reached through this one
        $other = $this->brand();
        $theirs = $this->actingAs($this->operator)->post("/api/operator/brands/{$other->id}/knowledge/files", ['file' => UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])->json('file.id');
        $this->actingAs($this->operator)->deleteJson("{$url}/{$theirs}")->assertNotFound();
    }

    public function test_host_opens_files_of_brands_they_go_live_for_only(): void
    {
        Storage::fake('local');
        $host = $this->host();
        $mine = $this->brand(['name' => 'Wardah']);
        $notMine = $this->brand();
        $host->assignments()->create(['brand_id' => $mine->id, 'status' => 'active']);
        $upload = fn (Brand $brand) => $this->actingAs($this->operator)
            ->post("/api/operator/brands/{$brand->id}/knowledge/files", ['file' => UploadedFile::fake()->create('pk.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
            ->json('file.id');
        $file = $upload($mine);
        $theirs = $upload($notMine);

        $this->actingAs($host->user)->getJson('/api/host/brands')
            ->assertJsonCount(1, 'brands.0.files')
            ->assertJsonPath('brands.0.files.0.original_name', 'pk.pdf');
        $this->actingAs($host->user)->getJson("/api/host/brands/{$mine->id}")->assertJsonCount(1, 'brand.files');

        $this->actingAs($host->user)->get("/api/host/brands/{$mine->id}/files/{$file}")->assertOk();
        $this->actingAs($host->user)->get("/api/host/brands/{$notMine->id}/files/{$theirs}")->assertForbidden();
        $this->actingAs($host->user)->get("/api/host/brands/{$mine->id}/files/{$theirs}")->assertNotFound();
    }

    public function test_host_sees_product_knowledge_of_active_assigned_brands_only(): void
    {
        $host = $this->host();
        $assigned = $this->brand(['name' => 'Wardah', 'product_knowledge' => 'Lip cream 12 shades']);
        $banned = $this->brand(['product_knowledge' => 'Secret']);
        $this->brand(['product_knowledge' => 'Not mine']);
        $host->assignments()->create(['brand_id' => $assigned->id, 'status' => 'active']);
        $host->assignments()->create(['brand_id' => $banned->id, 'status' => 'banned']);

        $this->actingAs($host->user)->getJson('/api/host/brands')
            ->assertOk()
            ->assertJsonCount(1, 'brands')
            ->assertJsonPath('brands.0.name', 'Wardah')
            ->assertJsonPath('brands.0.product_knowledge', '<p>Lip cream 12 shades</p>')
            ->assertJsonPath('brands.0.via', 'assigned');

        // Opened from a session
        $this->actingAs($host->user)->getJson("/api/host/brands/{$assigned->id}")
            ->assertOk()
            ->assertJsonPath('brand.product_knowledge', '<p>Lip cream 12 shades</p>');
        $this->actingAs($host->user)->getJson("/api/host/brands/{$banned->id}")->assertForbidden();
    }

    public function test_backup_cover_sees_the_other_brands_knowledge_until_a_day_after(): void
    {
        $this->travelTo(now()->setTime(9, 0));
        $cover = $this->host();
        $other = $this->brand(['name' => 'Skintific', 'product_knowledge' => 'Serum 5X Ceramide']);
        $requester = $this->host();
        $slot = ScheduleSlot::create([
            'assignment_id' => $requester->assignments()->create(['brand_id' => $other->id, 'status' => 'active'])->id,
            'day_of_week' => now()->dayOfWeekIso, 'start_time' => '19:00', 'end_time' => '21:00', 'effective_from' => today()->subMonth(),
        ]);
        BackupRequest::create([
            'slot_id' => $slot->id, 'brand_id' => $other->id, 'requesting_host_id' => $requester->id,
            'backup_date' => today(), 'start_at' => today()->setTime(19, 0), 'end_at' => today()->setTime(21, 0),
            'reason_type' => 'permit', 'status' => 'filled', 'filled_by_host_id' => $cover->id, 'auto_fill_at' => today()->setTime(18, 30),
        ]);

        $this->actingAs($cover->user)->getJson("/api/host/brands/{$other->id}")
            ->assertOk()
            ->assertJsonPath('brand.product_knowledge', '<p>Serum 5X Ceramide</p>');
        $this->actingAs($cover->user)->getJson('/api/host/brands')
            ->assertJsonPath('brands.0.name', 'Skintific')
            ->assertJsonPath('brands.0.via', 'backup');

        // Not someone else's cover, and not long after it ended
        $this->actingAs($this->host()->user)->getJson("/api/host/brands/{$other->id}")->assertForbidden();
        $this->travelTo(today()->addDays(2));
        $this->actingAs($cover->user)->getJson("/api/host/brands/{$other->id}")->assertForbidden();
    }
}
