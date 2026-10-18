<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\DiscordLink;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\ViolationType;
use App\Services\PointService;
use Carbon\CarbonImmutable;
use Database\Seeders\HostRateCategorySeeder;
use Database\Seeders\RoleSeeder;
use Database\Seeders\ViolationTypeSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\RequiresPhpExtension;
use Tests\TestCase;

#[RequiresPhpExtension('sodium')]
class DiscordCommandTest extends TestCase
{
    use RefreshDatabase;

    private const MANAGE_MESSAGES = '8192';

    /** View Channel (1 << 10), Manage Messages (1 << 13) and Read Message History (1 << 16) */
    private const BOT_PERMISSIONS = '74752';

    private string $secretKey;

    private Brand $brand;

    private HostProfile $host;

    private HostProfile $other;

    /** Messages in channel "chan" that the fake Discord returns, newest first. */
    private array $channelMessages = [];

    protected function setUp(): void
    {
        parent::setUp();

        $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00')); // Monday
        $this->seed([RoleSeeder::class, HostRateCategorySeeder::class, ViolationTypeSeeder::class]);

        $keys = sodium_crypto_sign_keypair();
        $this->secretKey = sodium_crypto_sign_secretkey($keys);
        config(['services.discord' => [
            'bot_token' => 'test-token', 'client_id' => 'app', 'client_secret' => 'secret', 'guild_id' => 'guild',
            'public_key' => bin2hex(sodium_crypto_sign_publickey($keys)),
            'channels' => ['backups' => 'chan-backups', 'admin' => 'chan-admin'], 'roles' => [],
        ]]);

        // Every call succeeds; reading channel "chan" returns $channelMessages, registering returns the commands
        Http::fake(function (Request $request) {
            if ($request->method() === 'PUT') {
                return Http::response($request->data());
            }
            if ($request->method() === 'GET' && str_contains($request->url(), '/channels/chan/messages')) {
                return Http::response($this->channelMessages);
            }

            return Http::response(['id' => 'msg'], 200);
        });

        $this->brand = Brand::create(['name' => 'Brand A', 'target_hours_per_period' => 100]);
        $this->host = $this->host('d-host');
        $this->other = $this->host();
        ScheduleSlot::create([
            'assignment_id' => $this->host->assignments()->first()->id,
            'day_of_week' => 1, 'start_time' => '14:00', 'end_time' => '16:00', 'effective_from' => '2026-09-01',
        ]);
    }

    private function host(?string $discordId = null): HostProfile
    {
        $user = User::factory()->create();
        $user->assignRole('host');
        $user->ensureHostProfile();
        HostBrandAssignment::create(['host_id' => $user->hostProfile->id, 'brand_id' => $this->brand->id, 'status' => 'active']);
        if ($discordId) {
            DiscordLink::create(['user_id' => $user->id, 'discord_user_id' => $discordId, 'linked_at' => now()]);
        }

        return $user->hostProfile;
    }

    /** Post an interaction signed like Discord does. */
    private function interact(array $interaction, ?string $signature = null): TestResponse
    {
        $body = json_encode($interaction);
        $timestamp = (string) now()->getTimestamp();

        return $this->call('POST', '/api/discord/interactions', server: [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_SIGNATURE_ED25519' => $signature ?? bin2hex(sodium_crypto_sign_detached($timestamp.$body, $this->secretKey)),
            'HTTP_X_SIGNATURE_TIMESTAMP' => $timestamp,
        ], content: $body);
    }

    private function command(string $name, string $discordId = 'd-host', array $extra = []): TestResponse
    {
        return $this->interact([
            'type' => 2,
            'token' => 'tok',
            'guild_id' => 'guild',
            'channel_id' => 'chan',
            'member' => ['user' => ['id' => $discordId, 'username' => 'nina'], 'permissions' => '0'],
            'app_permissions' => self::BOT_PERMISSIONS,
            'data' => ['name' => $name],
            ...$extra,
        ]);
    }

    /** The answer that replaced "thinking…". */
    private function answer(): array
    {
        $edits = Http::recorded(fn (Request $request) => $request->method() === 'PATCH' && str_ends_with($request->url(), '/webhooks/app/tok/messages/@original'));
        $this->assertCount(1, $edits);

        return $edits->first()[0]->data();
    }

    /** A message id (snowflake) for a message sent at that moment. */
    private function snowflake(CarbonImmutable $at, int $sequence = 0): string
    {
        return (string) ((((int) $at->getTimestampMs() - 1420070400000) << 22) + $sequence);
    }

    public function test_requests_without_discords_signature_are_refused(): void
    {
        $this->interact(['type' => 1], signature: str_repeat('ab', 64))->assertUnauthorized();
        $this->postJson('/api/discord/interactions', ['type' => 1])->assertUnauthorized();

        $this->interact(['type' => 1])->assertOk()->assertExactJson(['type' => 1]);
    }

    public function test_unlinked_discord_users_are_told_to_connect_first(): void
    {
        $this->command('jadwal', 'd-stranger')
            ->assertOk()
            ->assertJsonPath('type', 4)
            ->assertJsonPath('data.flags', 64)
            ->assertJsonPath('data.content', fn (string $content) => str_contains($content, 'belum terhubung'));

        Http::assertNothingSent();
    }

    public function test_jadwal_lists_todays_and_tomorrows_sessions_only_to_the_host(): void
    {
        $this->command('jadwal')->assertOk()->assertExactJson(['type' => 5, 'data' => ['flags' => 64]]);

        $embed = $this->answer()['embeds'][0];
        $this->assertSame('📅 Jadwal kamu', $embed['title']);
        $this->assertSame('Hari ini · Senin, 5 Oktober', $embed['fields'][0]['name']);
        $start = CarbonImmutable::parse('2026-10-05 14:00')->getTimestamp();
        $this->assertSame("🎥 **Brand A** · <t:{$start}:t>–<t:".($start + 7200).':t>', $embed['fields'][0]['value']);
        $this->assertSame('Tidak ada jadwal.', $embed['fields'][1]['value']);
    }

    public function test_backup_lists_other_hosts_backups_the_host_can_take(): void
    {
        $slot = ScheduleSlot::create([
            'assignment_id' => $this->other->assignments()->first()->id,
            'day_of_week' => 2, 'start_time' => '18:00', 'end_time' => '20:00', 'effective_from' => '2026-09-01',
        ]);
        $this->actingAs($this->other->user)->postJson('/api/host/backups', [
            'slot_id' => $slot->id, 'backup_date' => '2026-10-06', 'reason_type' => 'permit',
        ])->assertCreated();

        $this->command('backup')->assertOk();

        $description = $this->answer()['embeds'][0]['description'];
        $this->assertStringContainsString('**Brand A**', $description);
        $this->assertStringContainsString("untuk {$this->other->user->name}", $description);
    }

    public function test_poin_shows_points_sp_and_the_last_deductions(): void
    {
        app(PointService::class)->deduct($this->host, ViolationType::firstOrFail(), 'internal', null, null, points: 10);

        $this->command('poin')->assertOk();

        $fields = collect($this->answer()['embeds'][0]['fields'])->pluck('value', 'name');
        $this->assertSame('**90** dari 100', $fields['Poin']);
        $this->assertSame('Tidak ada', $fields['SP']);
        $this->assertSame('SP1 kalau poin turun ke 75', $fields['SP berikutnya']);
        $this->assertStringStartsWith('-10 · ', $fields['Potongan terakhir']);
    }

    public function test_gaji_without_approved_hours_says_so(): void
    {
        $this->command('gaji')->assertOk();

        $this->assertSame('Belum ada jam yang disetujui di periode yang sedang berjalan.', $this->answer()['embeds'][0]['description']);
    }

    public function test_clear_needs_manage_messages_for_the_member_and_the_bot(): void
    {
        $this->command('clear')
            ->assertJsonPath('type', 4)
            ->assertJsonPath('data.content', fn (string $content) => str_contains($content, 'Manage Messages'));

        $this->command('clear', extra: [
            'member' => ['user' => ['id' => 'd-mod'], 'permissions' => self::MANAGE_MESSAGES],
            'app_permissions' => '0',
        ])->assertJsonPath('data.content', fn (string $content) => str_starts_with($content, '🔒 Bot butuh izin'));

        Http::assertNothingSent();
    }

    public function test_clear_deletes_recent_messages_in_bulk_old_ones_one_by_one_and_keeps_pinned(): void
    {
        $now = CarbonImmutable::now();
        $recent = [$this->snowflake($now->subMinutes(5)), $this->snowflake($now->subDays(2))];
        $pinned = $this->snowflake($now->subDays(3));
        $old = $this->snowflake($now->subDays(20));
        $this->channelMessages = [
            ['id' => $recent[0]], ['id' => $recent[1]], ['id' => $pinned, 'pinned' => true], ['id' => $old],
        ];

        $this->command('clear', extra: [
            'member' => ['user' => ['id' => 'd-mod', 'username' => 'admin_nina'], 'permissions' => self::MANAGE_MESSAGES],
        ])->assertOk()->assertExactJson(['type' => 5, 'data' => ['flags' => 64]]);

        Http::assertSent(fn (Request $request) => $request->method() === 'POST'
            && str_ends_with($request->url(), '/channels/chan/messages/bulk-delete')
            && $request['messages'] === $recent
            && $request->header('X-Audit-Log-Reason')[0] === rawurlencode('/clear oleh admin_nina'));
        Http::assertSent(fn (Request $request) => $request->method() === 'DELETE' && str_ends_with($request->url(), "/channels/chan/messages/{$old}"));
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), $pinned) && $request->method() !== 'GET');

        $this->assertSame("🧹 **3** pesan dihapus.\n📌 1 pesan yang di-pin tidak dihapus.", $this->answer()['content']);
    }

    public function test_clear_with_a_count_deletes_only_the_newest_ones(): void
    {
        $now = CarbonImmutable::now();
        $this->channelMessages = [['id' => $this->snowflake($now, 2)], ['id' => $this->snowflake($now, 1)], ['id' => $this->snowflake($now)]];

        $this->command('clear', extra: [
            'member' => ['user' => ['id' => 'd-mod'], 'permissions' => self::MANAGE_MESSAGES],
            'data' => ['name' => 'clear', 'options' => [['name' => 'jumlah', 'type' => 4, 'value' => 2]]],
        ])->assertOk();

        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/bulk-delete')
            && $request['messages'] === [$this->snowflake($now, 2), $this->snowflake($now, 1)]);
        $this->assertSame('🧹 **2** pesan dihapus.', $this->answer()['content']);
    }

    public function test_register_command_puts_every_command_in_the_agency_server(): void
    {
        $this->artisan('discord:register-commands')
            ->expectsOutputToContain('/jadwal')
            ->expectsOutputToContain('/clear')
            ->assertSuccessful();

        Http::assertSent(fn (Request $request) => $request->method() === 'PUT'
            && str_ends_with($request->url(), '/applications/app/guilds/guild/commands')
            && collect($request->data())->pluck('name')->all() === ['jadwal', 'backup', 'poin', 'gaji', 'clear']);
    }
}
