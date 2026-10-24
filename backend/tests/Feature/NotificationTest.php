<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Attendance;
use App\Models\AuditLog;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\DiscordLink;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\ViolationType;
use App\Services\DiscordPreview;
use App\Services\Notice;
use App\Services\NotificationTypes;
use App\Services\Notifier;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Database\Seeders\ViolationTypeSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;
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

    /**
     * Turn the bot on and fake Discord: every call succeeds, DMs open channel "dm-<user>",
     * everyone is in the server. `$stubs` come first (to make some calls fail).
     */
    private function discord(array $stubs = [], ?string $adminRole = null): void
    {
        config(['services.discord' => [
            'bot_token' => 'test-token', 'client_id' => 'client', 'client_secret' => 'secret',
            'redirect' => 'http://localhost:3000/discord/callback', 'guild_id' => 'guild',
            'channels' => ['backups' => 'chan-backups', 'admin' => 'chan-admin'],
            'roles' => ['admin' => $adminRole],
        ]]);

        Http::fake([
            ...$stubs,
            'discord.com/api/v10/users/@me/channels' => fn (Request $request) => Http::response(['id' => 'dm-'.$request['recipient_id']]),
            'discord.com/api/v10/channels/*' => Http::response(['id' => 'msg', 'name' => 'backup-needs']),
            'discord.com/api/v10/guilds/guild/members/*' => Http::response([], 204),
            'discord.com/api/v10/guilds/guild*' => Http::response(['id' => 'guild', 'name' => 'Agensi', 'approximate_member_count' => 40]),
        ]);
    }

    private function link(User $user, string $discordId, array $muted = []): DiscordLink
    {
        return DiscordLink::create(['user_id' => $user->id, 'discord_user_id' => $discordId, 'muted_categories' => $muted, 'linked_at' => now()]);
    }

    /** The state "Connect Discord" hands this user for the consent page. */
    private function connectState(User $user): string
    {
        return $this->actingAs($user)->getJson('/api/discord/connect-url')->assertOk()->json('state');
    }

    /** The messages posted to a Discord channel (a server channel or "dm-<user>"). */
    private function posted(string $channelId): Collection
    {
        return Http::recorded(fn (Request $request) => $request->method() === 'POST' && str_ends_with($request->url(), "/channels/{$channelId}/messages"))
            ->map(fn (array $pair) => $pair[0]->data());
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

        $message = $this->posted('chan-backups')->sole();
        $embed = $message['embeds'][0];
        $this->assertSame('🆘 Butuh backup: Brand A', $embed['title']);
        $this->assertSame('http://localhost:3000/host/backups', $embed['url']);
        $this->assertSame('Brand A', $embed['author']['name']);
        $this->assertSame(NotificationTypes::BLUE, $embed['color']);
        $this->assertSame('VidHelp · Backup', $embed['footer']['text']);
        $fields = collect($embed['fields'])->pluck('value', 'name');
        $this->assertStringStartsWith('<t:'.CarbonImmutable::parse('2026-10-06 14:00')->getTimestamp().':F>', $fields['Waktu']);
        $this->assertSame($this->requester->user->name, $fields['Untuk']);
        // Nobody in particular is pinged, and @everyone never is; no buttons to a localhost frontend
        $this->assertArrayNotHasKey('content', $message);
        $this->assertSame([], $message['allowed_mentions']['parse']);
        $this->assertArrayNotHasKey('components', $message);
        $this->assertSame(0, AppNotification::where('channel', 'discord_channel')->where('status', '!=', 'sent')->count());
    }

    public function test_link_buttons_open_the_public_frontend(): void
    {
        config(['app.frontend_url' => 'https://app.vidhelp.id']);
        $this->discord();

        $this->openBackup();

        $button = $this->posted('chan-backups')->sole()['components'][0]['components'][0];
        $this->assertSame(['type' => 2, 'style' => 5, 'label' => 'Daftar di VidHelp', 'url' => 'https://app.vidhelp.id/host/backups'], $button);
    }

    public function test_direct_request_pings_the_nominees_in_the_channel_and_dms_them(): void
    {
        $third = $this->host();
        $this->link($this->other->user, '555');
        $this->link($third->user, '666');
        $this->discord();

        $this->actingAs($this->requester->user)->postJson('/api/host/backups', [
            'slot_id' => $this->slot->id, 'backup_date' => '2026-10-06', 'reason_type' => 'permit',
            'request_type' => 'direct', 'host_ids' => [$this->other->id, $third->id],
        ])->assertCreated();

        $post = $this->posted('chan-backups')->sole();
        $this->assertSame('<@555> <@666>', $post['content']);
        $this->assertSame(['parse' => [], 'users' => ['555', '666'], 'roles' => []], $post['allowed_mentions']);
        $this->assertStringContainsString('Minta digantikan', $post['embeds'][0]['title']);
        $this->assertCount(1, $this->posted('dm-555'));
        $this->assertCount(1, $this->posted('dm-666'));
    }

    public function test_admin_alerts_ping_the_admin_role_and_show_the_applicant(): void
    {
        $this->discord(adminRole: 'role-admins');
        $backup = $this->openBackup();

        $this->actingAs($this->other->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk();

        $post = $this->posted('chan-admin')->sole();
        $this->assertSame('<@&role-admins>', $post['content']);
        $this->assertSame(['role-admins'], $post['allowed_mentions']['roles']);
        $fields = collect($post['embeds'][0]['fields'])->pluck('value', 'name');
        $this->assertSame($this->other->user->name, $fields['Pendaftar']);
        $this->assertSame('100', $fields['Poin']);
        $this->assertSame('Brand sendiri', $fields['Brand']);
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

        $notifier->toChannel('admin', Notice::make('test', 'Hello'));
        $row = AppNotification::firstOrFail();
        $notifier->deliver($row->id);
        $this->assertSame('failed', $row->fresh()->status);

        // The first retry waits 2 minutes
        $this->travel(1)->minutes();
        $this->artisan('notifications:retry-discord')->assertSuccessful();
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
        $notifier->toUsers($this->other->user, Notice::make('test', 'First'));
        $notifier->toUsers($this->other->user, Notice::make('test', 'Second')->link('/host/live'));
        $notifier->toUsers($this->requester->user, Notice::make('test', 'Not yours'));

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
        $consent = $this->actingAs($user)->getJson('/api/discord/connect-url')->assertOk();
        $this->assertStringStartsWith('https://discord.com/oauth2/authorize?', $consent->json('url'));
        $this->assertStringContainsString('scope=identify+guilds.join', $consent->json('url'));
        $this->assertStringContainsString('state='.$consent->json('state'), $consent->json('url'));

        $this->actingAs($user)->postJson('/api/discord/link', ['code' => 'the-code', 'state' => $consent->json('state')])->assertOk()
            ->assertJsonPath('link.discord_username', 'Samuel')
            ->assertJsonPath('link.muted', [])
            ->assertJsonPath('link.in_guild', true);
        // The bot adds them to the agency server with their token, so it can DM them
        Http::assertSent(fn (Request $request) => $request->method() === 'PUT'
            && str_ends_with($request->url(), '/guilds/guild/members/777')
            && $request['access_token'] === 'user-token');

        $this->actingAs($user)->postJson('/api/discord/test')->assertOk();
        $this->assertStringStartsWith('🔔 Halo ', $this->posted('dm-777')->sole()['embeds'][0]['title']);

        // The same Discord account can't be linked to a second VidHelp user
        $this->actingAs($this->requester->user)->postJson('/api/discord/link', ['code' => 'the-code', 'state' => $this->connectState($this->requester->user)])->assertJsonValidationErrors('code');

        $this->actingAs($user)->deleteJson('/api/discord/link')->assertOk();
        $this->assertSame(0, DiscordLink::count());
    }

    public function test_linking_discord_needs_this_users_state_once(): void
    {
        $this->discord();
        Http::fake([
            'discord.com/api/oauth2/token' => Http::response(['access_token' => 'user-token']),
            'discord.com/api/v10/users/@me' => Http::response(['id' => '777', 'username' => 'attacker']),
        ]);
        $victim = $this->other->user;

        // The attacker's own consent page and code, finished in the victim's browser
        $attackerState = $this->connectState($this->requester->user);
        $this->actingAs($victim)->postJson('/api/discord/link', ['code' => 'the-code', 'state' => $attackerState])->assertJsonValidationErrors('code');
        $this->actingAs($victim)->postJson('/api/discord/link', ['code' => 'the-code'])->assertJsonValidationErrors('state');
        Http::assertNothingSent();

        $state = $this->connectState($victim);
        $this->actingAs($victim)->postJson('/api/discord/link', ['code' => 'the-code', 'state' => $state])->assertOk();
        $this->actingAs($victim)->postJson('/api/discord/link', ['code' => 'the-code', 'state' => $state])->assertJsonValidationErrors('code');

        $this->assertSame(1, DiscordLink::count());
        $this->assertSame(1, AuditLog::where('action', 'discord_linked')->where('target_id', $victim->id)->count());
    }

    public function test_muted_categories_skip_the_dm_but_critical_ones_still_come(): void
    {
        $this->link($this->requester->user, '555', muted: ['points']);
        $this->discord();
        $operator = User::factory()->create();
        $operator->assignRole('operator');

        $this->actingAs($operator)->postJson('/api/operator/points/violations', [
            'host_id' => $this->requester->id,
            'violation_type_id' => ViolationType::where('name', 'Telat')->value('id'),
            'points' => 30,
            'reason' => 'Late 45 minutes',
        ])->assertCreated();

        // The deduction is muted; the SP it caused is critical
        $this->assertNotNull($this->web($this->requester->user, 'points_deducted'));
        $this->assertSame(['sp_issued'], AppNotification::where('user_id', $this->requester->user_id)->where('channel', 'discord_dm')->pluck('type')->all());
        $fields = collect($this->posted('dm-555')->sole()['embeds'][0]['fields'])->pluck('value', 'name');
        $this->assertSame('SP1', $fields['Level']);
    }

    public function test_users_choose_their_dm_categories_and_staff_start_with_staff_alerts_muted(): void
    {
        $this->discord();
        Http::fake([
            'discord.com/api/oauth2/token' => Http::response(['access_token' => 'user-token']),
            'discord.com/api/v10/users/@me' => Http::response(['id' => '888', 'username' => 'boss']),
        ]);

        $this->actingAs($this->admin)->postJson('/api/discord/link', ['code' => 'the-code', 'state' => $this->connectState($this->admin)])->assertOk()->assertJsonPath('link.muted', ['admin']);
        $this->actingAs($this->admin)->getJson('/api/discord')->assertJsonPath('categories.0.key', 'payroll');
        $this->actingAs($this->admin)->putJson('/api/discord/preferences', ['muted' => []])->assertOk()->assertJsonPath('link.muted', []);

        $host = $this->other->user;
        $this->link($host, '555');
        $this->actingAs($host)->putJson('/api/discord/preferences', ['muted' => ['backup', 'points']])->assertOk();
        $this->assertSame(['backup', 'points'], DiscordLink::where('user_id', $host->id)->value('muted_categories'));
        // Staff alerts aren't a host's to mute
        $this->actingAs($host)->putJson('/api/discord/preferences', ['muted' => ['admin']])->assertJsonValidationErrors('muted.0');
    }

    public function test_a_short_rate_limit_is_waited_out(): void
    {
        Sleep::fake();
        config(['services.discord.bot_token' => 'test-token', 'services.discord.channels.admin' => 'chan-admin']);
        Http::fakeSequence('discord.com/*')->push(['message' => 'You are being rate limited.', 'retry_after' => 0.4], 429)->push(['id' => 'msg']);
        $notifier = app(Notifier::class);

        $notifier->toChannel('admin', Notice::make('test', 'Hello'));
        $row = AppNotification::firstOrFail();
        $notifier->deliver($row->id);

        $this->assertSame('sent', $row->fresh()->status);
        $this->assertSame(1, $row->fresh()->attempts);
        Sleep::assertSleptTimes(1);
    }

    public function test_closed_dms_are_not_retried_and_the_discord_card_says_so(): void
    {
        $this->link($this->other->user, '555');
        $this->discord(['discord.com/api/v10/channels/dm-555/messages' => Http::response(['message' => 'Cannot send messages to this user', 'code' => 50007], 403)]);
        $backup = $this->openBackup();

        $this->actingAs($this->admin)->postJson("/api/operator/backups/{$backup->id}/assign", ['host_id' => $this->other->id])->assertOk();

        $dm = AppNotification::where('user_id', $this->other->user_id)->where('channel', 'discord_dm')->sole();
        $this->assertSame('failed', $dm->status);
        $this->assertSame(3, $dm->attempts);
        $this->assertNotNull(DiscordLink::firstOrFail()->dm_blocked_at);

        $this->travel(1)->hours();
        $this->artisan('notifications:retry-discord')->assertSuccessful();
        $this->assertCount(1, $this->posted('dm-555'));
        $this->actingAs($this->other->user)->getJson('/api/discord')->assertJsonPath('link.dm_blocked', true);
    }

    public function test_hosts_are_reminded_before_and_at_the_start_of_a_session_once(): void
    {
        $this->link($this->requester->user, '555');
        $this->discord();

        // 25 minutes before the requester's Tuesday 14:00 session
        $this->travelTo(CarbonImmutable::parse('2026-10-06 13:35'));
        $this->artisan('notifications:send-reminders')->assertSuccessful();
        $this->artisan('notifications:send-reminders')->assertSuccessful();

        $soon = AppNotification::where('user_id', $this->requester->user_id)->where('type', 'reminder_live_soon');
        $this->assertSame(1, (clone $soon)->where('channel', 'web')->count());
        $this->assertSame(1, (clone $soon)->where('channel', 'discord_dm')->count());
        $this->assertSame('Live di Brand A mulai pukul 14:00', $soon->first()->title);
        $this->assertNull($this->web($this->other->user, 'reminder_live_soon'));

        // It started and they still haven't checked in
        $this->travelTo(CarbonImmutable::parse('2026-10-06 14:03'));
        $this->artisan('notifications:send-reminders')->assertSuccessful();
        $this->assertSame('Kamu belum check-in di Brand A', $this->web($this->requester->user, 'reminder_check_in')->title);

        // Turned off
        $this->travelTo(CarbonImmutable::parse('2026-10-13 13:35'));
        config(['vidhelp.notifications.live_reminder_minutes' => 0]);
        $this->artisan('notifications:send-reminders')->assertSuccessful();
        $this->assertSame(1, AppNotification::where('type', 'reminder_live_soon')->where('channel', 'web')->count());
    }

    public function test_hosts_are_reminded_of_a_live_report_and_a_sick_letter_before_they_are_due(): void
    {
        Attendance::create([
            'host_id' => $this->requester->id, 'slot_id' => $this->slot->id, 'brand_id' => $this->brand->id,
            'session_date' => '2026-10-06', 'scheduled_start_at' => '2026-10-06 14:00', 'scheduled_end_at' => '2026-10-06 16:00',
            'check_in_at' => '2026-10-06 13:55', 'report_due_at' => '2026-10-07 13:55',
        ]);
        $this->actingAs($this->requester->user)->postJson('/api/host/backups', [
            'slot_id' => $this->slot->id, 'backup_date' => '2026-10-13', 'reason_type' => 'sick',
        ])->assertCreated();

        $this->travelTo(CarbonImmutable::parse('2026-10-07 11:30'));
        $this->artisan('notifications:send-reminders')->assertSuccessful();
        $this->assertSame('Laporan live Brand A belum dikirim', $this->web($this->requester->user, 'reminder_report_due')->title);

        // The letter is due 24 hours after the session starts
        $this->travelTo(CarbonImmutable::parse('2026-10-14 12:00'));
        $this->artisan('notifications:send-reminders')->assertSuccessful();
        $this->artisan('notifications:send-reminders')->assertSuccessful();
        $this->assertSame(1, AppNotification::where('type', 'reminder_sick_letter')->where('channel', 'web')->count());
    }

    public function test_staff_are_reminded_before_an_applicant_is_picked_automatically(): void
    {
        $this->discord();
        $backup = $this->openBackup();
        $this->actingAs($this->other->user)->postJson("/api/host/backups/{$backup->id}/apply")->assertOk();

        // Auto-pick is at 13:30
        $this->travelTo(CarbonImmutable::parse('2026-10-06 12:45'));
        $this->artisan('notifications:send-reminders')->assertSuccessful();
        $this->artisan('notifications:send-reminders')->assertSuccessful();

        $this->assertSame(1, AppNotification::where('user_id', $this->admin->id)->where('type', 'backup_decision_due')->where('channel', 'web')->count());
        $this->assertSame(1, AppNotification::where('type', 'backup_decision_due')->where('channel', 'discord_channel')->count());
    }

    public function test_admin_panel_checks_the_setup_and_resends_failed_messages(): void
    {
        $this->link($this->other->user, '555');
        $this->discord();

        $this->actingAs($this->admin)->getJson('/api/admin/notifications/discord')->assertOk()
            ->assertJsonPath('bot.configured', true)
            ->assertJsonPath('guild.ok', true)
            ->assertJsonPath('guild.name', 'Agensi')
            ->assertJsonPath('channels.0.ok', true)
            ->assertJsonPath('channels.0.name', '#backup-needs')
            ->assertJsonPath('linked.hosts', 1)
            ->assertJsonPath('linked.hosts_total', 2);

        $failed = AppNotification::create([
            'type' => 'backup_opened', 'title' => 'Butuh backup: Brand A', 'channel' => 'discord_channel', 'target' => 'chan-backups',
            'status' => 'failed', 'attempts' => 3, 'error' => 'Discord 503: Unavailable',
        ]);
        $this->actingAs($this->admin)->getJson('/api/admin/notifications/deliveries?status=failed')->assertOk()
            ->assertJsonPath('deliveries.total', 1)
            ->assertJsonPath('deliveries.data.0.to', '#backup-needs')
            ->assertJsonPath('deliveries.data.0.error', 'Discord 503: Unavailable');

        $this->actingAs($this->admin)->postJson("/api/admin/notifications/deliveries/{$failed->id}/resend")->assertOk()->assertJsonPath('delivery.status', 'sent');
        $this->actingAs($this->admin)->postJson('/api/admin/notifications/test-channel', ['channel' => 'admin'])->assertOk();
        $this->assertCount(1, $this->posted('chan-admin'));

        $this->actingAs($this->other->user)->getJson('/api/admin/notifications/discord')->assertForbidden();
    }

    public function test_every_notification_type_has_an_example(): void
    {
        $this->assertEqualsCanonicalizing(NotificationTypes::types(), app(DiscordPreview::class)->types());
    }

    public function test_admin_sends_examples_one_by_one_without_pinging_anyone(): void
    {
        $this->discord(adminRole: 'role-admins');

        $types = $this->actingAs($this->admin)->postJson('/api/admin/notifications/preview', ['to' => 'admin'])->assertOk()->json('types');
        $this->assertContains('backup_applied', $types);

        $this->actingAs($this->admin)->postJson('/api/admin/notifications/preview', ['to' => 'admin', 'type' => 'backup_applied'])->assertOk();

        $message = $this->posted('chan-admin')->sole();
        $this->assertSame('🧪 Contoh `backup_applied` <@&role-admins>', $message['content']);
        $this->assertSame(['parse' => []], $message['allowed_mentions']);
        $this->assertStringStartsWith('🙋 ', $message['embeds'][0]['title']);
        // Examples aren't notifications: nothing for the bell or the delivery list
        $this->assertSame(0, AppNotification::count());

        // My DM needs a linked Discord
        $this->actingAs($this->admin)->postJson('/api/admin/notifications/preview', ['to' => 'me', 'type' => 'slip_ready'])->assertJsonValidationErrors('to');
        $this->link($this->admin, '888');
        $this->actingAs($this->admin)->postJson('/api/admin/notifications/preview', ['to' => 'me', 'type' => 'slip_ready'])->assertOk();
        $this->assertCount(1, $this->posted('dm-888'));
    }

    public function test_preview_command_posts_examples_to_a_channel(): void
    {
        $this->discord();
        Sleep::fake();

        $this->artisan('discord:preview', ['to' => 'backups', '--only' => ['backup_opened', 'event_opened']])
            ->expectsOutputToContain('backup_opened')
            ->assertSuccessful();

        $this->assertCount(2, $this->posted('chan-backups'));
        Sleep::assertSleptTimes(1);
        $this->artisan('discord:preview', ['to' => 'nobody@contoh.com'])->assertFailed();
    }
}
