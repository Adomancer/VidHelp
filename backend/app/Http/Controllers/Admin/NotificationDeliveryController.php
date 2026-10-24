<?php

namespace App\Http\Controllers\Admin;

use App\Exceptions\DiscordException;
use App\Http\Controllers\Controller;
use App\Models\AppNotification;
use App\Models\DiscordLink;
use App\Models\User;
use App\Services\DiscordClient;
use App\Services\DiscordPreview;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Throwable;

/**
 * The Discord panel: is the bot set up, who linked Discord, and every Discord message
 * with its status, so failed ones can be sent again.
 */
class NotificationDeliveryController extends Controller
{
    private const CHANNELS = ['backups' => '#backup-needs', 'admin' => '#admin-alerts'];

    public function __construct(private DiscordClient $discord) {}

    /** Bot, server and channels (checked against Discord), linked users and the last 24 hours. */
    public function status(): JsonResponse
    {
        $configured = $this->discord->configured();

        $since = now()->subDay();
        $stats = AppNotification::whereIn('channel', ['discord_channel', 'discord_dm'])
            ->where('created_at', '>=', $since)
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $activeHosts = User::role('host')->where('status', 'active');
        $activeStaff = User::role(['admin', 'finance', 'operator'])->where('status', 'active');

        return response()->json([
            'bot' => ['configured' => $configured, 'can_connect' => $this->discord->canConnect()],
            'guild' => $this->check(filled(config('services.discord.guild_id')), fn () => $this->discord->guild(), fn (array $guild) => [
                'name' => $guild['name'] ?? null,
                'members' => $guild['approximate_member_count'] ?? null,
            ]),
            'channels' => collect(self::CHANNELS)->map(fn (string $label, string $key) => [
                'key' => $key,
                'label' => $label,
                'role_ping' => filled(config("services.discord.roles.{$key}")),
                ...$this->check(filled(config("services.discord.channels.{$key}")), fn () => $this->discord->channel(config("services.discord.channels.{$key}")), fn (array $channel) => [
                    'name' => isset($channel['name']) ? "#{$channel['name']}" : null,
                ]),
            ])->values(),
            'linked' => [
                'hosts' => DiscordLink::whereHas('user', fn ($q) => $q->role('host')->where('status', 'active'))->count(),
                'hosts_total' => (clone $activeHosts)->count(),
                'staff' => DiscordLink::whereHas('user', fn ($q) => $q->role(['admin', 'finance', 'operator'])->where('status', 'active'))->count(),
                'staff_total' => (clone $activeStaff)->count(),
                'dm_blocked' => DiscordLink::whereNotNull('dm_blocked_at')->count(),
            ],
            'last_24h' => [
                'sent' => (int) ($stats['sent'] ?? 0),
                'pending' => (int) ($stats['pending'] ?? 0),
                'failed' => (int) ($stats['failed'] ?? 0),
                'skipped' => (int) ($stats['skipped'] ?? 0),
            ],
        ]);
    }

    /** Discord messages of the last 7 days, newest first, optionally by status and channel. */
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => 'nullable|in:pending,sent,failed,skipped',
            'channel' => 'nullable|in:discord_channel,discord_dm',
        ]);

        $page = AppNotification::query()
            ->whereIn('channel', ['discord_channel', 'discord_dm'])
            ->where('created_at', '>=', now()->subDays(7))
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($filters['channel'] ?? null, fn ($q, $channel) => $q->where('channel', $channel))
            ->with('user:id,name')
            ->latest()
            ->paginate(25)
            ->through(fn (AppNotification $row) => $this->row($row));

        return response()->json(['deliveries' => $page]);
    }

    /** Send a failed or skipped message again, now. */
    public function resend(AppNotification $notification, Notifier $notifier): JsonResponse
    {
        abort_if($notification->channel === 'web', 404);
        abort_if($notification->status === 'sent', 422, 'Pesan ini sudah terkirim.');
        abort_unless($this->discord->configured(), 422, 'Bot Discord belum dikonfigurasi di server.');

        $row = $notifier->resend($notification)->load('user:id,name');

        return response()->json([
            'delivery' => $this->row($row),
            'message' => $row->status === 'sent' ? 'Terkirim ulang' : 'Masih gagal: '.$row->error,
        ], $row->status === 'sent' ? 200 : 422);
    }

    /**
     * Post the example of one notification type to a channel or my DM. The panel calls this
     * once per type (with `types` from the first call), so it can show progress.
     */
    public function preview(Request $request, DiscordPreview $preview): JsonResponse
    {
        $data = $request->validate([
            'to' => 'required|in:backups,admin,me',
            'type' => ['nullable', 'string', Rule::in($preview->types())],
        ]);

        if (! isset($data['type'])) {
            return response()->json(['types' => $preview->types()]);
        }

        $channelId = $preview->channelFor($data['to'] === 'me' ? $request->user()->load('discordLink') : $data['to']);

        try {
            $preview->send($channelId, $data['type']);
        } catch (Throwable $e) {
            return response()->json(['message' => 'Discord menolak contoh ini: '.DiscordException::describe($e)], 422);
        }

        return response()->json(['message' => 'Terkirim']);
    }

    /** Post a sample message to #backup-needs or #admin-alerts. */
    public function testChannel(Request $request, Notifier $notifier): JsonResponse
    {
        $data = $request->validate(['channel' => 'required|in:'.implode(',', array_keys(self::CHANNELS))]);

        $error = $notifier->testChannel($data['channel'], $request->user());

        return $error
            ? response()->json(['message' => $error], 422)
            : response()->json(['message' => 'Terkirim ke '.self::CHANNELS[$data['channel']]]);
    }

    private function row(AppNotification $row): array
    {
        return [
            'id' => $row->id,
            'type' => $row->type,
            'title' => $row->title,
            'channel' => $row->channel,
            'to' => $row->channel === 'discord_dm' ? ($row->user?->name ?? 'Pengguna dihapus') : $this->channelLabel($row->target),
            'status' => $row->status,
            'attempts' => $row->attempts,
            'error' => $row->error,
            'created_at' => $row->created_at,
            'sent_at' => $row->sent_at,
        ];
    }

    private function channelLabel(?string $channelId): string
    {
        if (! $channelId) {
            return 'Channel belum diatur';
        }
        $key = array_search($channelId, array_filter(config('services.discord.channels')), true);

        return $key ? self::CHANNELS[$key] : "Channel {$channelId}";
    }

    /**
     * Ask Discord about something set in .env: ok, its details, or why it failed.
     *
     * @return array{set: bool, ok: ?bool, error: ?string}
     */
    private function check(bool $set, callable $fetch, callable $details): array
    {
        if (! $set || ! $this->discord->configured()) {
            return ['set' => $set, 'ok' => null, 'error' => null];
        }

        try {
            return ['set' => true, 'ok' => true, 'error' => null, ...$details($fetch())];
        } catch (Throwable $e) {
            return ['set' => true, 'ok' => false, 'error' => DiscordException::describe($e)];
        }
    }
}
