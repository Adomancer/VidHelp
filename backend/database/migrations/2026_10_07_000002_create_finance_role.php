<?php

use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

return new class extends Migration
{
    /**
     * The finance role, for databases seeded before it existed (RoleSeeder also creates it).
     */
    public function up(): void
    {
        $finance = Role::firstOrCreate(['name' => 'finance', 'guard_name' => 'web']);
        $finance->givePermissionTo([
            Permission::firstOrCreate(['name' => 'view-finance', 'guard_name' => 'web']),
            Permission::firstOrCreate(['name' => 'manage-finance', 'guard_name' => 'web']),
        ]);

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Role::where('name', 'finance')->where('guard_name', 'web')->delete();

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
