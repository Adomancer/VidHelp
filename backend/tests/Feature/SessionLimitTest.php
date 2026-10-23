<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * Sign-ins end after vidhelp.sessions: admin/finance 24 h max, 12 h idle; operator 7 days / 24 h;
 * host 30 days / 14 days.
 */
class SessionLimitTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
    }

    private function userWithRole(string ...$roles): User
    {
        $user = User::factory()->create();
        $user->assignRole($roles);

        return $user;
    }

    /** A fresh request, as the next one from the browser (the guard doesn't remember the last user). */
    private function me(string $token): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->getJson('/api/auth/me');
    }

    public function test_tokens_expire_after_the_role_session_length(): void
    {
        $this->freezeSecond(); // the column keeps whole seconds

        foreach (['admin' => 24, 'finance' => 24, 'operator' => 24 * 7, 'host' => 24 * 30] as $role => $hours) {
            $this->userWithRole($role)->issueToken();
            $this->assertEquals(now()->addHours($hours), PersonalAccessToken::latest('id')->first()->expires_at, $role);
        }
    }

    public function test_admin_sign_in_ends_after_24_hours_even_when_used(): void
    {
        $token = $this->userWithRole('admin')->issueToken();

        foreach (range(1, 2) as $step) {
            $this->travel(11)->hours();
            $this->me($token)->assertOk();
        }

        $this->travel(3)->hours(); // 25 h after logging in, 3 h after the last request
        $this->me($token)->assertUnauthorized();
    }

    public function test_admin_sign_in_survives_under_12_idle_hours(): void
    {
        $token = $this->userWithRole('finance')->issueToken();

        $this->travel(11 * 60 + 59)->minutes();
        $this->me($token)->assertOk();

        $this->travel(11 * 60 + 59)->minutes(); // 23 h 58 min after logging in, 11 h 59 min idle
        $this->me($token)->assertOk();
    }

    public function test_admin_sign_in_ends_after_12_idle_hours(): void
    {
        $token = $this->userWithRole('admin')->issueToken();

        $this->travel(1)->hours();
        $this->me($token)->assertOk();

        $this->travel(12 * 60 + 1)->minutes(); // 13 h after logging in (max is 24 h), 12 h 1 min idle
        $this->me($token)->assertUnauthorized();
    }

    public function test_operator_sign_in_lasts_a_week_while_used_daily(): void
    {
        $token = $this->userWithRole('operator')->issueToken();

        foreach (range(1, 6) as $day) {
            $this->travel(23)->hours();
            $this->me($token)->assertOk();
        }

        $this->travel(25)->hours(); // a day and an hour idle
        $this->me($token)->assertUnauthorized();
    }

    public function test_host_sign_in_survives_a_long_weekend_and_ends_after_30_days(): void
    {
        $token = $this->userWithRole('host')->issueToken();

        $this->travel(13)->days();
        $this->me($token)->assertOk();

        $this->travel(13)->days();
        $this->me($token)->assertOk();

        $this->travel(5)->days(); // 31 days after logging in
        $this->me($token)->assertUnauthorized();
    }

    public function test_host_sign_in_ends_after_14_idle_days(): void
    {
        $token = $this->userWithRole('host')->issueToken();

        $this->travel(14)->days();
        $this->travel(1)->minutes();
        $this->me($token)->assertUnauthorized();
    }

    public function test_the_strictest_role_wins(): void
    {
        $token = $this->userWithRole('host', 'admin')->issueToken();

        $this->travel(13)->hours();
        $this->me($token)->assertUnauthorized();
    }

    public function test_promotion_to_admin_shortens_an_existing_sign_in(): void
    {
        $user = $this->userWithRole('host');
        $token = $user->issueToken();

        $this->travel(2)->days();
        $this->me($token)->assertOk();

        $user->syncRoles(['admin']);
        $this->me($token)->assertUnauthorized();
    }

    public function test_tokens_issued_before_the_limits_follow_them(): void
    {
        $admin = $this->userWithRole('admin');
        $host = $this->userWithRole('host');
        $adminToken = $admin->createToken('auth-token')->plainTextToken; // no expires_at, like old tokens
        $hostToken = $host->createToken('auth-token')->plainTextToken;

        $this->travel(2)->days();

        $this->me($adminToken)->assertUnauthorized();
        $this->me($hostToken)->assertOk();
    }

    public function test_daily_prune_deletes_expired_and_long_idle_tokens_only(): void
    {
        $admin = $this->userWithRole('admin');
        $host = $this->userWithRole('host');
        $admin->issueToken(); // expires in 24 h
        $host->createToken('legacy'); // no expiry, never used
        $activeHost = $host->createToken('active')->accessToken;

        $this->travel(13)->days();
        $activeHost->forceFill(['last_used_at' => now()])->save();
        $this->travel(2)->days();

        Artisan::call('sanctum:prune-expired', ['--hours' => 0]);
        $this->artisan('schedule:test', ['--name' => 'sessions:prune-idle'])->assertSuccessful();

        $this->assertSame(['active'], PersonalAccessToken::pluck('name')->all());
    }
}
