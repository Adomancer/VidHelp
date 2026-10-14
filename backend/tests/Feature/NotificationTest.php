<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\DiscordLink;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\ViolationType;
use App\Services\Notifier;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Database\Seeders\ViolationTypeSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class NotificationTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Brand $brand;

    private HostProfile $requester;

    private HostProfile $other;

    private ScheduleSlot $slot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class, ViolationTypeSeeder::class]);
        $this->admin = User::where('email', 'admin@vidhelp.com')->firstOrFail();

        $this->brand = Brand::create(['name' => 'Brand A', 'target_hours_per_period' => 100]);
        $this->requester = $this->host();
        $this->other = $this->host();
        $this->slot = ScheduleSlot::create([
            'assignment_id' => $this->requester->assignments()->first()->id,
            'day_of_week' => 2, 'start_time' => '14:00', 'end_time' => '16:00', 'effective_from' => '2026-09-01',
        ]);
    }

    private function host(): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();
        HostBrandAssignment::create(['host_id' => $user->hostProfile->id, 'brand_id' => $this->brand->id, 'status' => 'active']);

        return $user->hostProfile;
    }

    /** Turn the bot on and fake Discord: every call succeeds, DMs open channel "dm-<user>". */
    private function discord(): void
    {
        config(['services.discord' => [
            'bot_token' => 'test-token', 'client_id' => 'client', 'client_secret' => 'secret',
            'redirect' => 'http://localhost:3000/discord/callback', 'guild_id' => 'guild',
            'channels' => ['backups' => 'chan-backups', 'admin' => 'chan-admin'],
        ]]);

        Http::fake([
            'discord.com/api/v10/users/@me/channels' => fn (Request $request) => Http::response(['id' => 'dm-'.$request['recipient_id']]),
            'discord.com/api/v10/channels/*' => Http::response(['id' => 'msg']),
        ]);
    }

    private function openBackup(): BackupRequest
    {
        $id = $this->actingAs($this->requester->user)->postJson('/api/host/backups', [
            'slot_id' => $this->slot->id, 'backup_date' => '2026-10-06', 'reason_type' => 'permit',
        ])->assertCreated()->json('request.id');

        return BackupRequest::findOrFail($id);
    }

    private function web(User $user, string $type): ?AppNotification
    {
        return AppNotification::where('user_id', $user->id)->where('channel', 'web')->where('type', $type)->latest()->first();
    }

    public function test_signup_alerts_admins_in_app_and_skips_discord_when_not_configured(): void
    {
        $this->postJson('/api/auth/register', [
            'name' => 'Nina', 'email' => 'nina@host.com', 'password' => 'secret123', 'password_confirmation' => 'secret123',
        ])->assertCreated();

        $this->assertSame('Pendaftar baru: Nina', $this->web($this->admin, 'signup_pending')->title);
        $this->assertSame('skipped', AppNotification::where('channel', 'discord_channel')->value('status'));
        Http::assertNothingSent();
    }

    public function test_opened_backup_goes_to_other_hosts_and_the_backup_channel(): void
    {
        $this->discord();

        $this->openBackup();

        $this->assertNotNull($this->web($this->other->user, 'backup_opened'));
        $this->assertNull($this->web($this->requester->user, 'backup_opened'));

        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/channels/chan-backups/messages')
            && $request['embeds'][0]['title'] === 'Butuh backup: Brand A'
            && $request['embeds'][0]['url'] === 'http://localhost:3000/host/backups');
        $this->assertSame(0, AppNotification::where('channel', 'discord_channel')->where('status', '!=', 'sent')->count());
    }

    public function test_picked_cover_gets_a_dm_when_linked(): void
    {
        $backup = $this->openBackup();
        $this->discord();
        DiscordLink::create(['user_id' => $this->other->user_id, 'discord_user_id' => '555', 'linked_at' => now()]);

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->other->id])->assertOk();

        $this->assertSame('Kamu menggantikan di Brand A', $this->web($this->other->user, 'backup_picked')->title);
        $this->assertNotNull($this->web($this->requester->user, 'backup_covered'));
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/users/@me/channels') && $request['recipient_id'] === '555');
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/channels/dm-555/messages'));
        $this->assertSame('dm-555', DiscordLink::firstOrFail()->dm_channel_id);
        // The requester never linked Discord: in-app only
        $this->assertSame(0, AppNotification::where('user_id', $this->requester->user_id)->where('channel', 'discord_dm')->count());
    }

    public function test_failed_discord_message_is_retried(): void
    {
        config(['services.discord.bot_token' => 'test-token', 'services.discord.channels.admin' => 'chan-admin']);
        Http::fakeSequence('discord.com/*')->push(['message' => 'Unavailable'], 503)->push(['id' => 'msg']);
        $notifier = app(Notifier::class);

        $notifier->toChannel('admin', 'test', 'Hello');
        $row = AppNotification::firstOrFail();
        $notifier->deliver($row->id);
        $this->assertSame('failed', $row->fresh()->status);

        $this->travel(1)->minutes();
        $this->artisan('notifications:retry-discord')->assertSuccessful();

        $this->assertSame('sent', $row->fresh()->status);
        $this->assertSame(2, $row->fresh()->attempts);
    }

    public function test_nobody_applied_alert_is_sent_once(): void
    {
        $this->openBackup();
        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:31'));

        $this->artisan('backups:auto-process');
        $this->artisan('backups:auto-process');

        $this->assertSame(1, AppNotification::where('user_id', $this->admin->id)->where('type', 'backup_no_cover')->count());
    }

    public function test_deduction_and_automatic_sp_notify_host_and_admins(): void
    {
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->postJson('/api/operator/points/violations', [
            'host_id' => $this->requester->id,
            'violation_type_id' => ViolationType::where('name', 'Telat')->value('id'),
            'points' => 30,
            'reason' => 'Late 45 minutes',
        ])->assertCreated();

        $deduction = $this->web($this->requester->user, 'points_deducted');
        $this->assertSame('-30 poin: Telat', $deduction->title);
        $this->assertSame('Late 45 minutes Poinmu sekarang 70.', $deduction->body);
        $this->assertSame('Kamu mendapat SP1', $this->web($this->requester->user, 'sp_issued')->title);
        $this->assertStringStartsWith('SP1 untuk ', $this->web($this->admin, 'sp_issued')->title);
    }

    public function test_new_event_tells_the_brands_hosts(): void
    {
        $this->actingAs($this->admin)->postJson('/api/operator/events', [
            'brand_id' => $this->brand->id, 'name' => 'PD 10.10', 'start_date' => '2026-10-09', 'end_date' => '2026-10-10',
            'daily_start_time' => '10:00', 'daily_end_time' => '16:00', 'block_minutes' => 120, 'max_slots_per_host' => 2,
        ])->assertCreated();

        $notification = $this->web($this->other->user, 'event_opened');
        $this->assertSame('Event baru: PD 10.10 (Brand A)', $notification->title);
        $this->assertSame('/host/events', $notification->link);
    }

    public function test_approving_an_account_tells_the_user(): void
    {
        $user = User::factory()->pending()->create();
        $user->assignRole('host');

        $this->actingAs($this->admin)->postJson("/api/admin/users/{$user->id}/activate")->assertOk();

        $this->assertSame('Akunmu sudah disetujui', $this->web($user, 'account_approved')->title);
    }

    public function test_bell_lists_counts_and_marks_read(): void
    {
        $notifier = app(Notifier::class);
        $notifier->toUsers($this->other->user, 'test', 'First');
        $notifier->toUsers($this->other->user, 'test', 'Second', link: '/host/live');
        $notifier->toUsers($this->requester->user, 'test', 'Not yours');

        $list = $this->actingAs($this->other->user)->getJson('/api/notifications')
            ->assertJsonPath('unread', 2)
            ->assertJsonCount(2, 'notifications')
            ->json('notifications');

        $this->actingAs($this->other->user)->postJson("/api/notifications/{$list[0]['id']}/read")->assertOk();
        $this->actingAs($this->other->user)->getJson('/api/notifications/unread-count')->assertJsonPath('unread', 1);

        $theirs = AppNotification::where('user_id', $this->requester->user_id)->firstOrFail();
        $this->actingAs($this->other->user)->postJson("/api/notifications/{$theirs->id}/read")->assertNotFound();

        $this->actingAs($this->other->user)->postJson('/api/notifications/read-all')->assertOk();
        $this->actingAs($this->other->user)->getJson('/api/notifications/unread-count')->assertJsonPath('unread', 0);
    }

    public function test_host_connects_discord_and_sends_a_test_message(): void
    {
        $this->discord();
        Http::fake([
            'discord.com/api/oauth2/token' => Http::response(['access_token' => 'user-token']),
            'discord.com/api/v10/users/@me' => Http::response(['id' => '777', 'username' => 'samuel', 'global_name' => 'Samuel']),
        ]);
        $user = $this->other->user;

        $this->actingAs($user)->getJson('/api/discord')->assertJsonPath('available', true)->assertJsonPath('link', null);
        $this->assertStringStartsWith('https://discord.com/oauth2/authorize?', $this->actingAs($user)->getJson('/api/discord/connect-url?state=abc')->json('url'));

        $this->actingAs($user)->postJson('/api/discord/link', ['code' => 'the-code'])->assertOk()->assertJsonPath('link.discord_username', 'Samuel');
        $this->actingAs($user)->postJson('/api/discord/test')->assertOk();
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/channels/dm-777/messages'));

        // The same Discord account can't be linked to a second VidHelp user
        $this->actingAs($this->requester->user)->postJson('/api/discord/link', ['code' => 'the-code'])->assertJsonValidationErrors('code');

        $this->actingAs($user)->deleteJson('/api/discord/link')->assertOk();
        $this->assertSame(0, DiscordLink::count());
    }
}
