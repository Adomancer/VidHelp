<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\TwoFactorAuth;
use App\Models\User;
use App\Services\Totp;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;
use Tests\TestCase;

class TwoFactorTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
        config(['vidhelp.two_factor.required_for_admins' => true]);

        $this->admin = User::factory()->create(['email' => 'boss@vidhelp.com']);
        $this->admin->assignRole('admin');
    }

    private function login(string $email = 'boss@vidhelp.com'): TestResponse
    {
        return $this->postJson('/api/auth/login', ['email' => $email, 'password' => 'password']);
    }

    /** Set 2FA up through the API; returns [secret, recovery codes]. */
    private function enableFor(User $user): array
    {
        $token = $user->issueToken();
        $secret = $this->withToken($token)->postJson('/api/two-factor/setup')->assertOk()->json('secret');
        $codes = $this->withToken($token)->postJson('/api/two-factor/confirm', [
            'code' => Totp::code($secret, Totp::step()),
        ])->assertOk()->json('recovery_codes');
        $user->tokens()->delete();
        $this->app['auth']->forgetGuards();

        return [$secret, $codes];
    }

    /** Pretend the previous code was used so the next check needs a new 30-second step. */
    private function nextCode(string $secret): string
    {
        TwoFactorAuth::where('user_id', $this->admin->id)->update(['last_used_step' => Totp::step() - 2]);

        return Totp::code($secret, Totp::step());
    }

    public function test_admin_without_2fa_is_limited_to_setting_it_up(): void
    {
        $response = $this->login()->assertOk()->assertJsonPath('user.two_factor_setup_required', true);
        $token = $response->json('token');

        $this->withToken($token)->getJson('/api/admin/dashboard')
            ->assertForbidden()
            ->assertJsonPath('code', 'two_factor_setup_required');
        $this->withToken($token)->getJson('/api/auth/me')->assertOk();
        $this->withToken($token)->getJson('/api/two-factor')->assertOk()->assertJson(['required' => true, 'enabled' => false]);
    }

    public function test_setup_turns_2fa_on_and_returns_recovery_codes(): void
    {
        $token = $this->login()->json('token');

        $setup = $this->withToken($token)->postJson('/api/two-factor/setup')->assertOk();
        $this->assertStringStartsWith('otpauth://totp/VidHelp%3Aboss%40vidhelp.com?secret=', $setup->json('otpauth_url'));

        $this->withToken($token)->postJson('/api/two-factor/confirm', ['code' => '000000'])->assertUnprocessable();

        $codes = $this->withToken($token)->postJson('/api/two-factor/confirm', [
            'code' => Totp::code($setup->json('secret'), Totp::step()),
        ])->assertOk()->assertJsonPath('user.two_factor_setup_required', false)->json('recovery_codes');

        $this->assertCount(8, $codes);
        $this->assertTrue($this->admin->fresh()->two_factor_enabled);
        $this->withToken($token)->getJson('/api/admin/dashboard')->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'two_factor_enabled', 'target_id' => $this->admin->id]);
    }

    public function test_login_with_2fa_needs_a_code_and_a_code_works_once(): void
    {
        [$secret] = $this->enableFor($this->admin);

        $challenge = $this->login()->assertOk()
            ->assertJson(['two_factor' => true])
            ->assertJsonMissingPath('token')
            ->json('challenge_token');

        $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $challenge, 'code' => '123456'])
            ->assertUnprocessable()->assertJsonValidationErrors('code');

        $code = $this->nextCode($secret);
        $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $challenge, 'code' => $code])
            ->assertOk()->assertJsonStructure(['token', 'user']);

        // Challenge is used up, and the same code can't be replayed on a new sign-in
        $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $challenge, 'code' => $code])
            ->assertUnprocessable()->assertJsonValidationErrors('challenge_token');
        $again = $this->login()->json('challenge_token');
        $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $again, 'code' => $code])
            ->assertUnprocessable();

        $this->assertDatabaseHas('audit_logs', ['action' => 'two_factor_failed', 'user_id' => $this->admin->id]);
        $login = AuditLog::where('action', 'login')->sole();
        $this->assertSame(['method' => 'password', 'two_factor' => true], $login->new_value);
    }

    public function test_recovery_code_works_once(): void
    {
        [, $codes] = $this->enableFor($this->admin);

        $challenge = $this->login()->json('challenge_token');
        $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $challenge, 'recovery_code' => strtolower($codes[0])])
            ->assertOk();

        $challenge = $this->login()->json('challenge_token');
        $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $challenge, 'recovery_code' => $codes[0]])
            ->assertUnprocessable()->assertJsonValidationErrors('recovery_code');

        $this->assertCount(7, TwoFactorAuth::where('user_id', $this->admin->id)->sole()->recovery_codes_hash);
    }

    public function test_too_many_wrong_codes_ends_the_challenge(): void
    {
        [$secret] = $this->enableFor($this->admin);
        $challenge = $this->login()->json('challenge_token');

        foreach (range(1, 4) as $ignored) {
            $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $challenge, 'code' => '000000'])
                ->assertJsonValidationErrors('code');
        }
        $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $challenge, 'code' => '000000'])
            ->assertJsonValidationErrors('challenge_token');

        $this->postJson('/api/auth/two-factor-challenge', ['challenge_token' => $challenge, 'code' => $this->nextCode($secret)])
            ->assertJsonValidationErrors('challenge_token');
    }

    public function test_google_login_also_asks_admins_for_a_code(): void
    {
        $this->enableFor($this->admin);
        $googleUser = (new SocialiteUser)->map(['id' => 'google-1', 'name' => 'Admin', 'email' => 'boss@vidhelp.com']);
        $googleUser->user = ['email_verified' => true];
        Socialite::shouldReceive('driver->stateless->user')->andReturn($googleUser);

        $this->getJson('/api/auth/google/callback?code=abc')
            ->assertOk()
            ->assertJson(['two_factor' => true])
            ->assertJsonMissingPath('token');
    }

    public function test_hosts_and_operators_never_use_2fa(): void
    {
        $host = User::factory()->create(['email' => 'host@vidhelp.com']);
        $host->assignRole('host');

        $token = $this->login('host@vidhelp.com')->assertOk()->assertJsonPath('user.two_factor_setup_required', false)->json('token');
        $this->withToken($token)->getJson('/api/host/profile')->assertOk();
        $this->withToken($token)->postJson('/api/two-factor/setup')->assertForbidden();
    }

    public function test_finance_must_set_up_2fa_and_then_gets_a_code_step(): void
    {
        $finance = User::factory()->create(['email' => 'money@vidhelp.com']);
        $finance->assignRole('finance');

        $token = $this->login('money@vidhelp.com')->assertOk()->assertJsonPath('user.two_factor_setup_required', true)->json('token');
        $this->withToken($token)->getJson('/api/finance/payroll/periods')
            ->assertForbidden()
            ->assertJsonPath('code', 'two_factor_setup_required');

        $secret = $this->withToken($token)->postJson('/api/two-factor/setup')->assertOk()->json('secret');
        $this->withToken($token)->postJson('/api/two-factor/confirm', ['code' => Totp::code($secret, Totp::step())])->assertOk();
        $this->withToken($token)->getJson('/api/finance/payroll/periods')->assertOk();

        $this->app['auth']->forgetGuards();
        $this->login('money@vidhelp.com')->assertOk()->assertJson(['two_factor' => true])->assertJsonMissingPath('token');
    }

    public function test_required_2fa_cannot_be_turned_off_but_can_when_optional(): void
    {
        [$secret] = $this->enableFor($this->admin);
        $token = $this->admin->issueToken();

        $this->withToken($token)->deleteJson('/api/two-factor', ['code' => $this->nextCode($secret)])
            ->assertUnprocessable();

        config(['vidhelp.two_factor.required_for_admins' => false]);
        $this->withToken($token)->deleteJson('/api/two-factor', ['code' => $this->nextCode($secret)])->assertOk();

        $this->assertFalse($this->admin->fresh()->two_factor_enabled);
        $this->assertDatabaseMissing('two_factor_auth', ['user_id' => $this->admin->id]);
    }

    public function test_recovery_codes_can_be_regenerated_with_a_code(): void
    {
        [$secret, $old] = $this->enableFor($this->admin);
        $token = $this->admin->issueToken();

        $new = $this->withToken($token)->postJson('/api/two-factor/recovery-codes', ['code' => $this->nextCode($secret)])
            ->assertOk()->json('recovery_codes');

        $this->assertCount(8, $new);
        $this->assertEmpty(array_intersect($old, $new));
    }

    public function test_another_admin_can_reset_2fa_and_the_user_is_signed_out(): void
    {
        $this->enableFor($this->admin);
        $this->admin->issueToken();

        $other = User::factory()->create();
        $other->assignRole('admin');
        config(['vidhelp.two_factor.required_for_admins' => false]); // let $other act without setting it up

        $this->actingAs($other)->postJson("/api/admin/users/{$this->admin->id}/two-factor/reset")->assertOk();
        $this->actingAs($other)->postJson("/api/admin/users/{$other->id}/two-factor/reset")->assertUnprocessable();

        $this->assertFalse($this->admin->fresh()->two_factor_enabled);
        $this->assertSame(0, $this->admin->tokens()->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'two_factor_reset', 'user_id' => $other->id, 'target_id' => $this->admin->id]);
    }
}
