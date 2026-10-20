<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\DiscordLink;
use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
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
        Http::assertNothingSent(); // no Discord linked, no DM
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
