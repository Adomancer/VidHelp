<?php

namespace Tests\Feature;

use App\Models\BackupRequest;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\SalarySlip;
use App\Models\User;
use Database\Seeders\DemoSeeder;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DemoSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_data_covers_hosts_pay_periods_and_backups_and_runs_once(): void
    {
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class, DemoSeeder::class]);

        $this->assertSame(5, User::role('host')->where('email', 'like', 'host%@vidhelp.com')->count());
        $this->assertEqualsCanonicalizing(
            ['paid', 'paid', 'requested', 'in_progress'],
            PaymentPeriod::whereHas('brand', fn ($q) => $q->where('name', 'Glow Skincare'))->pluck('status')->all()
        );
        $this->assertGreaterThan(0, SalarySlip::count());
        $this->assertSame(1, LiveReport::where('status', 'flagged')->count());
        $this->assertEqualsCanonicalizing(['pending', 'open', 'filled'], BackupRequest::pluck('status')->all());

        // Running it again adds nothing
        $this->seed(DemoSeeder::class);
        $this->assertSame(5, User::where('email', 'like', 'host%@vidhelp.com')->count());

        $this->postJson('/api/auth/login', ['email' => 'host1@vidhelp.com', 'password' => 'password'])->assertOk();
    }
}
