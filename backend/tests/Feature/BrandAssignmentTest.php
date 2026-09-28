<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\HostProfile;
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
        return Brand::create($attributes + ['name' => 'Brand '.uniqid(), 'target_hours_per_period' => 100, 'payment_cycle_days' => 14]);
    }

    public function test_admin_creates_and_updates_brands(): void
    {
        $id = $this->actingAs($this->admin)->postJson('/api/admin/brands', [
            'name' => 'Skintific',
            'is_obs' => true,
            'target_hours_per_period' => 120,
            'payment_cycle_days' => 14,
        ])->assertCreated()->json('brand.id');

        $this->actingAs($this->admin)->putJson("/api/admin/brands/{$id}", ['status' => 'inactive'])
            ->assertOk()
            ->assertJsonPath('brand.status', 'inactive');

        $this->actingAs($this->admin)->postJson('/api/admin/brands', [
            'name' => 'Skintific', 'target_hours_per_period' => 1, 'payment_cycle_days' => 1,
        ])->assertJsonValidationErrors('name');
    }

    public function test_operator_can_list_but_not_create_brands(): void
    {
        $this->brand(['name' => 'Wardah']);

        $this->actingAs($this->operator)->getJson('/api/operator/brands')
            ->assertOk()
            ->assertJsonPath('brands.0.name', 'Wardah');

        $this->actingAs($this->operator)->postJson('/api/admin/brands', [
            'name' => 'X', 'target_hours_per_period' => 1, 'payment_cycle_days' => 1,
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

    public function test_host_cannot_use_operator_routes(): void
    {
        $host = $this->host();

        $this->actingAs($host->user)->getJson('/api/operator/hosts')->assertForbidden();
        $this->actingAs($host->user)->postJson('/api/operator/assignments', [])->assertForbidden();
    }
}
