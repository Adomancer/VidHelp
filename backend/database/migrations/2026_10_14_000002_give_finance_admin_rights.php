<?php

use Illuminate\Database\Migrations\Migration;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

return new class extends Migration
{
    /**
     * Finance gets every admin right plus changing payroll and kasbon; admin keeps
     * everything but those (it can still see them). Matches RoleSeeder.
     */
    public function up(): void
    {
        $admin = Role::firstOrCreate(['name' => 'admin', 'guard_name' => 'web']);
        $finance = Role::firstOrCreate(['name' => 'finance', 'guard_name' => 'web']);
        Permission::firstOrCreate(['name' => 'manage-finance', 'guard_name' => 'web']);

        $finance->syncPermissions(Permission::all());
        $admin->revokePermissionTo('manage-finance');

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }

    /**
     * Back to finance with payroll and kasbon only, and admin with everything.
     */
    public function down(): void
    {
        Role::where('name', 'finance')->first()?->syncPermissions(['view-finance', 'manage-finance']);
        Role::where('name', 'admin')->first()?->syncPermissions(Permission::all());

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
};
