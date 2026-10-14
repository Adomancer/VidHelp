<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class RoleSeeder extends Seeder
{
    /**
     * Seed the roles, permissions, and a default admin user.
     */
    public function run(): void
    {
        // Reset cached roles and permissions
        app()[PermissionRegistrar::class]->forgetCachedPermissions();

        // Create permissions
        $permissions = [
            // User management
            'manage-users',
            'view-users',

            // Schedule
            'manage-schedules',
            'view-schedules',
            'view-own-schedule',

            // Finance
            'view-finance',
            'manage-finance',

            // Ratings
            'manage-ratings',
            'view-ratings',
            'view-own-ratings',

            // Backup hosts
            'manage-backup-hosts',
        ];

        foreach ($permissions as $permission) {
            Permission::firstOrCreate(['name' => $permission]);
        }

        // Create roles and assign permissions. Admin can do everything but change payroll
        // and kasbon (it only sees them); finance can do everything admin can, plus those.
        $admin = Role::firstOrCreate(['name' => 'admin']);
        $admin->syncPermissions(Permission::where('name', '!=', 'manage-finance')->get());

        $operator = Role::firstOrCreate(['name' => 'operator']);
        $operator->givePermissionTo([
            'view-users',
            'manage-schedules',
            'view-schedules',
            'manage-ratings',
            'view-ratings',
            'manage-backup-hosts',
        ]);

        $finance = Role::firstOrCreate(['name' => 'finance']);
        $finance->syncPermissions(Permission::all());

        $host = Role::firstOrCreate(['name' => 'host']);
        $host->givePermissionTo([
            'view-own-schedule',
            'view-own-ratings',
        ]);

        // Create default admin user
        $adminUser = User::firstOrCreate(
            ['email' => 'admin@vidhelp.com'],
            [
                'name' => 'Admin',
                'password' => Hash::make('password'),
                'email_verified_at' => now(),
                'status' => 'active',
                'signup_source' => 'admin_created',
            ]
        );
        $adminUser->assignRole('admin');

        $this->command->info('Roles, permissions, and default admin seeded successfully!');
        $this->command->info('Default admin: admin@vidhelp.com / password');
    }
}
