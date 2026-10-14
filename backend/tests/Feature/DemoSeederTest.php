<?php

namespace Tests\Feature;

use App\Models\BackupRequest;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\PointLog;
use App\Models\SalarySlip;
use App\Models\User;
use Database\Seeders\DemoSeeder;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Database\Seeders\ViolationTypeSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DemoSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_data_covers_hosts_pay_periods_and_backups_and_runs_once(): void
    {
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class, ViolationTypeSeeder::class, DemoSeeder::class]);

        $this->assertSame(5, User::role('host')->where('email', 'like', 'host%@vidhelp.com')->count());
        // Periods close on hours, so the newest ones depend on today's weekday: the first two are
        // paid, one runs, and one in between may wait for its request or for the brand
        $statuses = PaymentPeriod::whereHas('brand', fn ($q) => $q->where('name', 'Glow Skincare'))->orderBy('period_start')->pluck('status')->all();
        $this->assertSame(['paid', 'paid'], array_slice($statuses, 0, 2));
        $this->assertSame('in_progress', end($statuses));
        $this->assertSame([], array_diff(array_slice($statuses, 2, -1), ['waiting_payment', 'requested']));
        // Kopi Nusantara's leader hasn't requested its latest closed period yet (on Monday or early
        // Tuesday Rizky's missed session keeps that period just short of its target, still running)
        $kopi = PaymentPeriod::whereHas('brand', fn ($q) => $q->where('name', 'Kopi Nusantara'))->orderBy('period_start')->pluck('status')->all();
        $this->assertSame(['paid', 'paid'], array_slice($kopi, 0, 2));
        $this->assertSame('in_progress', end($kopi));
        $this->assertSame([], array_diff(array_slice($kopi, 2, -1), ['waiting_payment']));
        $this->assertSame(1, PointLog::where('source', 'late_check_in')->count());
        $this->assertGreaterThan(0, SalarySlip::count());
        $this->assertSame(1, LiveReport::where('status', 'flagged')->count());
        $this->assertEqualsCanonicalizing(['pending', 'open', 'filled'], BackupRequest::pluck('status')->all());

        // Running it again adds nothing
        $this->seed(DemoSeeder::class);
        $this->assertSame(5, User::where('email', 'like', 'host%@vidhelp.com')->count());

        $this->postJson('/api/auth/login', ['email' => 'host1@vidhelp.com', 'password' => 'password'])->assertOk();
    }
}
