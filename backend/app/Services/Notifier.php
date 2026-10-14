<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\DiscordLink;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Throwable;

/**
 * Sends notifications: always in-app, plus Discord (a channel post or a DM) where asked.
 * Discord messages go out after the response, so nobody waits on Discord; failures
 * are retried by `notifications:retry-discord`.
 */
class Notifier
{
    private const MAX_ATTEMPTS = 3;

    public function __construct(private DiscordClient $discord)
    {
    }

    /**
     * In-app notification for each user; with `$dm`, also a Discord DM to those who linked Discord.
     *
     * @param  User|iterable<User>  $users
     */
    public function toUsers(User|iterable $users, string $type, string $title, ?string $body = null, ?string $link = null, bool $dm = false, array $payload = []): void
    {
        $users = collect($users instanceof User ? [$users] : $users)->unique('id');

        foreach ($users as $user) {
            AppNotification::create([
                'user_id' => $user->id,
                'type' => $type, 'title' => $title, 'body' => $body, 'link' => $link, 'payload' => $payload,
                'channel' => 'web',
                'status' => 'sent',
                'sent_at' => now(),
            ]);

            $discordId = $dm ? $user->discordLink?->discord_user_id : null;
            if ($discordId) {
                $this->send(AppNotification::create([
                    'user_id' => $user->id,
                    'type' => $type, 'title' => $title, 'body' => $body, 'link' => $link, 'payload' => $payload,
                    'channel' => 'discord_dm',
                    'target' => $discordId,
                ]));
            }
        }
    }

    /**
     * Post to a server channel: `backups` (#backup-needs) or `admin` (#admin-alerts).
     */
    public function toChannel(string $channel, string $type, string $title, ?string $body = null, ?string $link = null, array $payload = []): void
    {
        $this->send(AppNotification::create([
            'type' => $type, 'title' => $title, 'body' => $body, 'link' => $link, 'payload' => $payload,
            'channel' => 'discord_channel',
            'target' => config("services.discord.channels.{$channel}"),
        ]));
    }

    /** Someone signed up (email or Google) and waits for approval. */
    public function signupPending(User $user): void
    {
        $title = "Pendaftar baru: {$user->name}";
        $body = "{$user->email} menunggu persetujuan.";

        $this->toUsers($this->admins(), 'signup_pending', $title, $body, '/admin/users');
        $this->toChannel('admin', 'signup_pending', $title, $body, '/admin/users');
    }

    /** Active admins. */
    public function admins(): Collection
    {
        return User::role('admin')->where('status', 'active')->with('discordLink')->get();
    }

    /** Active admins and finance staff (they follow payroll). */
    public function finance(): Collection
    {
        return User::role(['admin', 'finance'])->where('status', 'active')->with('discordLink')->get();
    }

    /** Active users of the brand's leader hosts (the brand's PIC, who requests payment). */
    public function brandLeaders(string $brandId): Collection
    {
        return User::query()
            ->where('status', 'active')
            ->whereHas('hostProfile.assignments', fn ($q) => $q->where('brand_id', $brandId)->where('is_leader', true)->where('status', 'active'))
            ->with('discordLink')
            ->get();
    }

    /** Active admins and operators. */
    public function staff(): Collection
    {
        return User::role(['admin', 'operator'])->where('status', 'active')->with('discordLink')->get();
    }

    /**
     * Active hosts' users, optionally only those on a brand, leaving one host out.
     */
    public function hosts(?string $brandId = null, ?string $exceptHostId = null): Collection
    {
        return User::query()
            ->where('status', 'active')
            ->whereHas('hostProfile', fn ($q) => $q
                ->where('status', 'active')
                ->when($exceptHostId, fn ($q) => $q->whereKeyNot($exceptHostId))
                ->when($brandId, fn ($q) => $q->whereHas('assignments', fn ($q) => $q->where('brand_id', $brandId)->where('status', 'active'))))
            ->with('discordLink')
            ->get();
    }

    /**
     * Deliver one Discord message now. Used after the response and by the retry job.
     */
    public function deliver(string $notificationId): void
    {
        $notification = AppNotification::find($notificationId);
        if (! $notification || $notification->channel === 'web' || $notification->status === 'sent') {
            return;
        }

        try {
            $channelId = $notification->channel === 'discord_dm' ? $this->dmChannel($notification->target) : $notification->target;
            $this->discord->postMessage($channelId, $this->message($notification));

            $notification->update(['status' => 'sent', 'sent_at' => now(), 'attempts' => $notification->attempts + 1, 'error' => null]);
        } catch (Throwable $e) {
            $notification->update(['status' => 'failed', 'attempts' => $notification->attempts + 1, 'error' => Str::limit($e->getMessage(), 250)]);
        }
    }

    /**
     * Retry Discord messages that failed or were never sent (up to 3 tries, within a day).
     */
    public function retry(): int
    {
        if (! $this->discord->configured()) {
            return 0;
        }

        $due = AppNotification::whereIn('channel', ['discord_channel', 'discord_dm'])
            ->where(fn ($q) => $q->where('status', 'failed')
                ->orWhere(fn ($q) => $q->where('status', 'pending')->where('created_at', '<', now()->subMinutes(2))))
            ->where('attempts', '<', self::MAX_ATTEMPTS)
            ->where('created_at', '>', now()->subDay())
            ->pluck('id');

        $due->each(fn (string $id) => $this->deliver($id));

        return $due->count();
    }

    /**
     * Send a Discord DM right away (the "send me a test message" button). Returns the error, if any.
     */
    public function testDm(User $user): ?string
    {
        if (! $this->discord->configured()) {
            return 'Discord belum dikonfigurasi di server.';
        }

        try {
            $this->discord->postMessage($this->dmChannel($user->discordLink->discord_user_id), [
                'content' => "Halo {$user->name}! Notifikasi VidHelp akan masuk ke sini.",
            ]);

            return null;
        } catch (Throwable $e) {
            report($e);

            return 'Discord menolak pesannya. Pastikan kamu sudah bergabung di server agensi dan mengizinkan pesan langsung dari anggota server.';
        }
    }

    private function send(AppNotification $notification): void
    {
        if (! $this->discord->configured() || ! $notification->target) {
            $notification->update(['status' => 'skipped', 'error' => 'Discord belum dikonfigurasi.']);

            return;
        }

        $id = $notification->id;
        dispatch(fn () => app(self::class)->deliver($id))->afterResponse();
    }

    private function dmChannel(string $discordUserId): string
    {
        $link = DiscordLink::where('discord_user_id', $discordUserId)->first();
        if ($link?->dm_channel_id) {
            return $link->dm_channel_id;
        }

        $channelId = $this->discord->openDm($discordUserId);
        $link?->update(['dm_channel_id' => $channelId]);

        return $channelId;
    }

    private function message(AppNotification $notification): array
    {
        $url = $notification->link ? rtrim(config('app.frontend_url'), '/').$notification->link : null;

        return [
            'embeds' => [array_filter([
                'title' => Str::limit($notification->title, 250),
                'description' => $notification->body ? Str::limit($notification->body, 2000) : null,
                'url' => $url,
                'color' => 0x9333EA,
                'timestamp' => $notification->created_at->toIso8601String(),
            ])],
        ];
    }
}
