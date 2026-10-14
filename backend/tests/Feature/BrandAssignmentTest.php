<?php

namespace Tests\Feature;

use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        $this->assertSame(
            ['No', 'Nama', 'Email', 'No. HP', 'No. HP wali', 'Status', 'Level tarif', 'Tarif per jam', 'Tanggal bergabung', 'Masa kerja (bulan)', 'Brand aktif', 'Leader di'],
            $hosts[0],
        );
        $this->assertCount(2, $hosts);
        $this->assertSame($assigned->user->email, $hosts[1][2]);
        $this->assertSame('08123456789', $hosts[1][3]);
        $this->assertSame('Aktif', $hosts[1][5]);
        // The banned assignment (Emina) isn't an active brand
        $this->assertSame('Wardah', $hosts[1][10]);
        $this->assertSame('Wardah', $hosts[1][11]);
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

    public function test_admin_saves_product_knowledge(): void
    {
        $id = $this->actingAs($this->admin)->postJson('/api/admin/brands', [
            'name' => 'Skintific',
            'product_knowledge' => "Serum 5X Ceramide\nHarga Rp 129.000",
            'target_hours_per_period' => 120,
        ])->assertCreated()
            ->assertJsonPath('brand.product_knowledge', "Serum 5X Ceramide\nHarga Rp 129.000")
            ->json('brand.id');

        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$id}", ['product_knowledge' => null])
            ->assertOk()
            ->assertJsonPath('brand.product_knowledge', null);
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
            ->assertJsonPath('brands.0.product_knowledge', 'Lip cream 12 shades')
            ->assertJsonPath('brands.0.via', 'assigned');

        // Opened from a session
        $this->actingAs($host->user)->getJson("/api/host/brands/{$assigned->id}")
            ->assertOk()
            ->assertJsonPath('brand.product_knowledge', 'Lip cream 12 shades');
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
            ->assertJsonPath('brand.product_knowledge', 'Serum 5X Ceramide');
        $this->actingAs($cover->user)->getJson('/api/host/brands')
            ->assertJsonPath('brands.0.name', 'Skintific')
            ->assertJsonPath('brands.0.via', 'backup');

        // Not someone else's cover, and not long after it ended
        $this->actingAs($this->host()->user)->getJson("/api/host/brands/{$other->id}")->assertForbidden();
        $this->travelTo(today()->addDays(2));
        $this->actingAs($cover->user)->getJson("/api/host/brands/{$other->id}")->assertForbidden();
    }
}
