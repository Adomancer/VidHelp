<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class RoleSeeder extends Seeder
{
    /** The first admin's password outside production when ADMIN_SEED_PASSWORD is empty. */
    private const DEV_PASSWORD = 'password';

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

        // Create the first admin. In production its password must come from ADMIN_SEED_PASSWORD:
        // with a well-known default anyone could sign in and enrol their own authenticator first.
        $email = config('vidhelp.seed_admin.email');
        $password = config('vidhelp.seed_admin.password');
        $adminUser = User::where('email', $email)->first();

        if (! $adminUser) {
            if (app()->isProduction() && (blank($password) || $password === self::DEV_PASSWORD)) {
                throw new RuntimeException('Set ADMIN_SEED_PASSWORD (not "'.self::DEV_PASSWORD.'") before seeding in production.');
            }

            $adminUser = User::create([
                'name' => 'Admin',
                'email' => $email,
                'password' => Hash::make(filled($password) ? $password : self::DEV_PASSWORD),
                'email_verified_at' => now(),
                'status' => 'active',
                'signup_source' => 'admin_created',
            ]);
        }
        $adminUser->assignRole('admin');

        $this->command->info('Roles, permissions, and default admin seeded successfully!');
        if ($adminUser->wasRecentlyCreated) {
            $this->command->info(filled($password) ? "Default admin: {$email} (password from ADMIN_SEED_PASSWORD)" : "Default admin: {$email} / ".self::DEV_PASSWORD);
        } elseif (app()->isProduction() && Hash::check(self::DEV_PASSWORD, (string) $adminUser->password)) {
            $this->command->error("{$email} still has the development password. Change it now.");
        }
    }
}
