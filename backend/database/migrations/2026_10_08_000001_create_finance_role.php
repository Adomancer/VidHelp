<?php

use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

return new class extends Migration
{
    /**
     * The finance role (payroll and kasbon). RoleSeeder creates it on fresh installs;
     * this adds it to databases that were seeded before the role existed.
     */
    public function up(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (['view-finance', 'manage-finance'] as $permission) {
            Permission::firstOrCreate(['name' => $permission, 'guard_name' => 'web']);
        }

        Role::firstOrCreate(['name' => 'finance', 'guard_name' => 'web'])
            ->givePermissionTo(['view-finance', 'manage-finance']);

        // Admins have every permission
        Role::where('name', 'admin')->first()?->givePermissionTo(['view-finance', 'manage-finance']);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Role::where('name', 'finance')->where('guard_name', 'web')->first()?->delete();

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
