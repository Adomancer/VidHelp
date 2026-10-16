<?php

namespace Tests\Feature;

use App\Models\Attendance;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\CashAdvance;
use App\Models\EventSlotClaim;
use App\Models\HostRating;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\PointLog;
use App\Models\SalarySlip;
use App\Models\SpecialEvent;
use App\Models\User;
use Database\Seeders\DemoSeeder;
use Database\Seeders\DemoSeeder2;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Database\Seeders\ViolationTypeSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DemoSeeder2Test extends TestCase
{
    use RefreshDatabase;

    public function test_bulk_demo_data_fills_every_module_and_runs_once(): void
    {
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class, ViolationTypeSeeder::class, DemoSeeder::class, DemoSeeder2::class]);

        $this->assertSame(40, User::role('host')->where('email', 'like', 'bulk%@vidhelp.com')->count());
        $this->assertSame(2, User::where('email', 'like', 'bulk%@vidhelp.com')->where('status', 'inactive')->count());
        $this->assertSame(6, User::where('email', 'like', 'daftar%@vidhelp.com')->where('status', 'pending')->count());
        $this->assertSame(12, Brand::count()); // 10 bulk + DemoSeeder's 2

        $this->assertGreaterThan(1000, Attendance::count());
        $this->assertGreaterThan(0, LiveReport::where('status', 'flagged')->count());
        $this->assertGreaterThan(0, LiveReport::where('status', 'rejected')->count());
        $this->assertGreaterThan(0, LiveReport::whereNotNull('reviewed_by')->where('status', 'approved')->count());

        $this->assertGreaterThan(20, PaymentPeriod::where('status', 'paid')->count());
        $this->assertGreaterThan(100, SalarySlip::count());
        $this->assertGreaterThan(5, CashAdvance::count());

        $this->assertGreaterThan(10, PointLog::where('source', 'late_check_in')->count());
        $this->assertGreaterThan(0, PointLog::where('source', 'brand_complaint')->count());
        $this->assertGreaterThan(80, HostRating::count());

        $this->assertSame(5, SpecialEvent::count());
        $this->assertSame(0, SpecialEvent::where('status', 'cancelled')->count());
        $this->assertGreaterThan(0, Attendance::whereNotNull('event_claim_id')->count());
        $this->assertGreaterThan(0, EventSlotClaim::where('start_at', '>', now())->count());

        $this->assertGreaterThan(0, Attendance::whereNotNull('backup_request_id')->count());
        $this->assertGreaterThan(0, BackupRequest::where('start_at', '>', now())->whereIn('status', ['open', 'pending'])->count());

        // Running it again adds nothing
        $this->seed(DemoSeeder2::class);
        $this->assertSame(40, User::where('email', 'like', 'bulk%@vidhelp.com')->count());

        $this->postJson('/api/auth/login', ['email' => 'bulk01@vidhelp.com', 'password' => 'password'])->assertOk();
    }
}
