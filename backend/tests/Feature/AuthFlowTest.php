<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\AuditLog;
use App\Models\DiscordLink;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use RuntimeException;
use Tests\TestCase;

class AuthFlowTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
    }

    public function test_active_user_logs_in_with_password_and_logs_out(): void
    {
        $user = User::factory()->create(['email' => 'host@vidhelp.com']);
        $user->assignRole('host');

        $token = $this->postJson('/api/auth/login', ['email' => 'host@vidhelp.com', 'password' => 'password'])
            ->assertOk()
            ->assertJsonPath('user.has_password', true)
            ->json('token');

        $this->withToken($token)->getJson('/api/auth/me')->assertOk()->assertJsonPath('user.email', 'host@vidhelp.com');
        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();

        $this->assertSame(0, $user->tokens()->count());
    }

    public function test_wrong_passwords_lock_that_email_from_that_ip_for_a_while(): void
    {
        $user = User::factory()->create(['email' => 'host@vidhelp.com']);
        $user->assignRole('host');

        foreach (range(1, 5) as $attempt) {
            $this->postJson('/api/auth/login', ['email' => 'host@vidhelp.com', 'password' => 'wrong'])
                ->assertJsonValidationErrors(['email' => 'Email atau kata sandi salah.']);
        }

        // Even the right password waits, whatever the email's case
        $this->postJson('/api/auth/login', ['email' => 'HOST@vidhelp.com', 'password' => 'password'])
            ->assertJsonValidationErrors(['email' => 'Terlalu banyak percobaan masuk']);

        $this->travel(2)->minutes();
        $this->postJson('/api/auth/login', ['email' => 'host@vidhelp.com', 'password' => 'password'])->assertOk();
    }

    public function test_wrong_passwords_from_many_ips_lock_the_account(): void
    {
        $user = User::factory()->create(['email' => 'host@vidhelp.com']);
        $user->assignRole('host');

        foreach (range(1, 5) as $ip) {
            foreach (range(1, 4) as $attempt) {
                $this->withServerVariables(['REMOTE_ADDR' => "10.0.0.{$ip}"])
                    ->postJson('/api/auth/login', ['email' => 'host@vidhelp.com', 'password' => 'wrong'])
                    ->assertJsonValidationErrors(['email' => 'Email atau kata sandi salah.']);
            }
        }

        $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.99'])
            ->postJson('/api/auth/login', ['email' => 'host@vidhelp.com', 'password' => 'password'])
            ->assertJsonValidationErrors(['email' => 'Terlalu banyak percobaan masuk']);
    }

    public function test_a_correct_password_resets_the_count(): void
    {
        $user = User::factory()->create(['email' => 'host@vidhelp.com']);
        $user->assignRole('host');

        foreach (range(1, 2) as $round) {
            foreach (range(1, 4) as $attempt) {
                $this->postJson('/api/auth/login', ['email' => 'host@vidhelp.com', 'password' => 'wrong'])->assertJsonValidationErrors('email');
            }
            $this->postJson('/api/auth/login', ['email' => 'host@vidhelp.com', 'password' => 'password'])->assertOk();
        }
    }

    public function test_seeding_the_first_admin_in_production_needs_its_password(): void
    {
        User::where('email', 'admin@vidhelp.com')->forceDelete();
        $this->app->detectEnvironment(fn () => 'production');

        foreach ([null, 'password'] as $password) {
            config(['vidhelp.seed_admin.password' => $password]);
            try {
                $this->seedInProduction();
                $this->fail('Seeded the first admin without a real password in production.');
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('ADMIN_SEED_PASSWORD', $e->getMessage());
            }
        }
        $this->assertNull(User::where('email', 'admin@vidhelp.com')->first());

        config(['vidhelp.seed_admin.password' => 'a-long-secret-from-env']);
        $this->seedInProduction();
        $admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
        $this->assertTrue(Hash::check('a-long-secret-from-env', $admin->password));
        $this->assertTrue($admin->hasRole('admin'));

        // Seeding again (e.g. after adding a role) doesn't need it anymore
        config(['vidhelp.seed_admin.password' => null]);
        $this->seedInProduction();
    }

    /** db:seed asks for confirmation in production; deploys pass --force. */
    private function seedInProduction(): void
    {
        $this->artisan('db:seed', ['--class' => RoleSeeder::class, '--force' => true])->run();
    }

    public function test_token_stops_working_once_user_is_no_longer_active(): void
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $token = $user->issueToken();

        $user->update(['status' => 'inactive']); // e.g. changed by an admin via PUT /admin/users/{id}

        $this->withToken($token)->getJson('/api/auth/me')
            ->assertForbidden()
            ->assertJson(['status' => 'inactive']);
    }

    public function test_password_reset_sends_frontend_link_and_sets_new_password(): void
    {
        Notification::fake();
        $user = User::factory()->create(['email' => 'host@vidhelp.com']);
        $user->issueToken();

        $this->postJson('/api/auth/forgot-password', ['email' => 'host@vidhelp.com'])->assertOk();

        $token = null;
        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $notification) use ($user, &$token) {
            $token = $notification->token;
            $url = $notification->toMail($user)->actionUrl;

            return str_starts_with($url, 'http://localhost:3000/reset-password?token=');
        });

        $this->postJson('/api/auth/reset-password', [
            'token' => $token,
            'email' => 'host@vidhelp.com',
            'password' => 'new-secret-1',
            'password_confirmation' => 'new-secret-1',
        ])->assertOk();

        $this->assertTrue(Hash::check('new-secret-1', $user->fresh()->password));
        $this->assertSame(0, $user->tokens()->count()); // signed out everywhere
        $this->assertSame(1, AuditLog::where('action', 'password_reset')->where('target_id', $user->id)->count());
        Http::assertNothingSent(); // no Discord linked, no DM
    }

    public function test_one_ip_can_only_sign_up_so_often(): void
    {
        foreach (range(1, 10) as $i) {
            $this->postJson('/api/auth/register', [
                'name' => "Host {$i}", 'email' => "host{$i}@mail.com", 'password' => 'secret123', 'password_confirmation' => 'secret123',
            ])->assertCreated();
            // Past the per-minute limit of the auth routes; the sign-up limit is per hour
            if ($i % 5 === 0) {
                $this->travel(61)->seconds();
            }
        }

        $this->postJson('/api/auth/register', [
            'name' => 'Host 11', 'email' => 'host11@mail.com', 'password' => 'secret123', 'password_confirmation' => 'secret123',
        ])->assertTooManyRequests()->assertJson(['message' => 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.']);
        $this->assertDatabaseMissing('users', ['email' => 'host11@mail.com']);
    }

    public function test_only_the_frontend_may_call_the_api_from_a_browser(): void
    {
        $this->getJson('/api/auth/google/redirect', ['Origin' => 'http://localhost:3000'])
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
        // Answered with the frontend's origin (not "*" or theirs), so the browser refuses the response
        $this->getJson('/api/auth/google/redirect', ['Origin' => 'https://evil.example'])
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    }

    public function test_password_reset_link_also_goes_to_a_linked_discord_dm_and_is_never_stored(): void
    {
        Notification::fake();
        config(['services.discord.bot_token' => 'test-token']);
        Http::fake([
            'discord.com/api/v10/users/@me/channels' => Http::response(['id' => 'dm-1']),
            'discord.com/api/v10/channels/dm-1/messages' => Http::response(['id' => 'msg']),
        ]);
        $user = User::factory()->create(['email' => 'host@vidhelp.com']);
        DiscordLink::create(['user_id' => $user->id, 'discord_user_id' => 'd-1', 'linked_at' => now()]);

        $this->postJson('/api/auth/forgot-password', ['email' => 'host@vidhelp.com'])->assertOk();

        $token = null;
        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $notification) use (&$token) {
            $token = $notification->token;

            return true;
        });
        $link = 'http://localhost:3000/reset-password?'.http_build_query(['token' => $token, 'email' => 'host@vidhelp.com']);
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/channels/dm-1/messages')
            && $request['embeds'][0]['url'] === $link
            && str_contains($request['embeds'][0]['description'], 'berlaku 60 menit'));

        // The link opens the account, so it stays out of the bell and the delivery log admins see
        $this->assertSame(0, AppNotification::count());
    }

    public function test_no_reset_dm_to_a_discord_linked_before_the_email_was_proven(): void
    {
        Notification::fake();
        config(['services.discord.bot_token' => 'test-token']);
        Http::fake();
        // Linked by whoever signed up with this email, before its owner signed in with Google
        $user = User::factory()->create(['email' => 'host@vidhelp.com', 'signup_source' => 'self_register', 'email_verified_at' => now()]);
        DiscordLink::create(['user_id' => $user->id, 'discord_user_id' => 'd-1', 'linked_at' => now()->subDay()]);

        $this->postJson('/api/auth/forgot-password', ['email' => 'host@vidhelp.com'])->assertOk();

        Notification::assertSentTo($user, ResetPassword::class);
        Http::assertNothingSent();
    }

    public function test_changing_the_password_says_which_discord_still_gets_reset_links(): void
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        DiscordLink::create(['user_id' => $user->id, 'discord_user_id' => 'd-1', 'discord_username' => 'Samuel', 'linked_at' => now()]);

        $this->actingAs($user)->postJson('/api/host/profile/password', [
            'current_password' => 'password', 'password' => 'new-password', 'password_confirmation' => 'new-password',
        ])->assertOk()->assertJsonPath('message', fn (string $message) => str_contains($message, 'Discord Samuel masih terhubung'));
    }

    public function test_forgot_password_does_not_reveal_unknown_emails(): void
    {
        $this->postJson('/api/auth/forgot-password', ['email' => 'nobody@vidhelp.com'])->assertOk();
    }

    public function test_reset_with_invalid_token_fails(): void
    {
        User::factory()->create(['email' => 'host@vidhelp.com']);

        $this->postJson('/api/auth/reset-password', [
            'token' => 'wrong',
            'email' => 'host@vidhelp.com',
            'password' => 'new-secret-1',
            'password_confirmation' => 'new-secret-1',
        ])->assertUnprocessable();
    }

    public function test_google_only_user_can_set_a_first_password(): void
    {
        $user = User::factory()->create(['password' => null, 'google_id' => 'google-123']);
        $user->assignRole('host');

        $this->actingAs($user)->postJson('/api/host/profile/password', [
            'password' => 'first-secret',
            'password_confirmation' => 'first-secret',
        ])->assertOk();

        $this->assertTrue(Hash::check('first-secret', $user->fresh()->password));
    }

    public function test_changing_password_requires_the_current_one(): void
    {
        $user = User::factory()->create();
        $user->assignRole('host');

        $this->actingAs($user)->postJson('/api/host/profile/password', [
            'current_password' => 'wrong',
            'password' => 'new-secret-1',
            'password_confirmation' => 'new-secret-1',
        ])->assertUnprocessable();
    }

    public function test_admin_cannot_deactivate_themselves(): void
    {
        $admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();

        $this->actingAs($admin)->postJson("/api/admin/users/{$admin->id}/deactivate")->assertUnprocessable();

        $this->assertSame('active', $admin->fresh()->status);
    }

    public function test_admin_can_list_pending_users(): void
    {
        $admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
        User::factory()->pending()->create(['email' => 'waiting@gmail.com']);
        User::factory()->create(['email' => 'active@gmail.com']);

        $this->actingAs($admin)->getJson('/api/admin/users?status=pending')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.email', 'waiting@gmail.com');
    }
}
