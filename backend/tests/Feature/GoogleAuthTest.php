<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;
use RuntimeException;
use Tests\TestCase;

class GoogleAuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RoleSeeder::class);
    }

    private function fakeGoogleUser(string $email = 'host@gmail.com', bool $verified = true): void
    {
        $googleUser = (new SocialiteUser)
            ->setRaw(['email_verified' => $verified])
            ->map([
                'id' => 'google-123',
                'name' => 'Test Host',
                'email' => $email,
                'avatar' => 'https://lh3.googleusercontent.com/a/photo',
            ]);

        Socialite::shouldReceive('driver->stateless->user')->andReturn($googleUser);
    }

    public function test_redirect_returns_google_consent_url(): void
    {
        config(['services.google.client_id' => 'test-client', 'services.google.redirect' => 'http://localhost:3000/auth/google/callback']);

        $response = $this->getJson('/api/auth/google/redirect')->assertOk();

        $this->assertStringStartsWith('https://accounts.google.com/o/oauth2/auth', $response->json('url'));
    }

    public function test_first_google_login_registers_a_pending_host_without_a_token(): void
    {
        $this->fakeGoogleUser();

        $this->getJson('/api/auth/google/callback?code=abc')
            ->assertStatus(202)
            ->assertJson(['status' => 'pending'])
            ->assertJsonMissing(['token']);

        $user = User::where('email', 'host@gmail.com')->firstOrFail();
        $this->assertSame('pending', $user->status);
        $this->assertSame('self_register', $user->signup_source);
        $this->assertSame('google-123', $user->google_id);
        $this->assertNull($user->password);
        $this->assertTrue($user->hasRole('host'));
    }

    public function test_pending_user_cannot_log_in_with_google(): void
    {
        User::factory()->pending()->create(['email' => 'host@gmail.com', 'google_id' => 'google-123']);
        $this->fakeGoogleUser();

        $this->getJson('/api/auth/google/callback?code=abc')
            ->assertForbidden()
            ->assertJson(['status' => 'pending']);
    }

    public function test_approved_user_gets_a_token(): void
    {
        $admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
        $host = User::factory()->pending()->create(['email' => 'host@gmail.com', 'google_id' => 'google-123']);
        $host->assignRole('host');

        $this->actingAs($admin)->postJson("/api/admin/users/{$host->id}/activate")->assertOk();

        $host->refresh();
        $this->assertSame('active', $host->status);
        $this->assertSame($admin->id, $host->approved_by);
        $this->assertNotNull($host->approved_at);

        $this->fakeGoogleUser();

        $response = $this->getJson('/api/auth/google/callback?code=abc')
            ->assertOk()
            ->assertJsonPath('user.roles.0.name', 'host');

        $this->assertNotEmpty($response->json('token'));
        $this->assertNotNull($host->fresh()->last_login_at);
    }

    public function test_google_login_links_existing_account_by_email(): void
    {
        $admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();
        $this->fakeGoogleUser('admin@vidhelp.com');

        $this->getJson('/api/auth/google/callback?code=abc')
            ->assertOk()
            ->assertJsonPath('user.roles.0.name', 'admin');

        $this->assertSame('google-123', $admin->fresh()->google_id);
        $this->assertSame(1, User::where('email', 'admin@vidhelp.com')->count());
    }

    public function test_unverified_google_email_is_rejected(): void
    {
        $this->fakeGoogleUser(verified: false);

        $this->getJson('/api/auth/google/callback?code=abc')->assertForbidden();

        $this->assertDatabaseMissing('users', ['email' => 'host@gmail.com']);
    }

    public function test_failed_code_exchange_returns_401(): void
    {
        Socialite::shouldReceive('driver->stateless->user')->andThrow(new RuntimeException('invalid_grant'));

        $this->getJson('/api/auth/google/callback?code=bad')->assertUnauthorized();
    }

    public function test_email_registration_is_pending_and_cannot_log_in(): void
    {
        $this->postJson('/api/auth/register', [
            'name' => 'Email Host',
            'email' => 'email@host.com',
            'password' => 'secret123',
            'password_confirmation' => 'secret123',
        ])->assertCreated()->assertJsonMissing(['token']);

        $this->postJson('/api/auth/login', ['email' => 'email@host.com', 'password' => 'secret123'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'Your account is waiting for admin approval.');
    }

    public function test_host_cannot_reach_admin_routes(): void
    {
        $host = User::factory()->create();
        $host->assignRole('host');

        $this->actingAs($host)->getJson('/api/admin/dashboard')->assertForbidden();
        $this->actingAs($host)->getJson('/api/host/profile')->assertOk();
    }
}
