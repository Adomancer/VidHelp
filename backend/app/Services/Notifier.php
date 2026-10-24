<?php

namespace App\Services;

use App\Exceptions\DiscordException;
use App\Models\AppNotification;
use App\Models\DiscordLink;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Throwable;

/**
 * Sends notifications: always in-app, plus Discord (a channel post or a DM) where asked.
 * Discord messages go out after the response, so nobody waits on Discord; failures
 * are retried by `notifications:retry-discord` with growing pauses.
 */
class Notifier
{
    private const MAX_ATTEMPTS = 3;

    /** Minutes to wait after the n-th failed attempt before trying again. */
    private const BACKOFF_MINUTES = [1 => 2, 2 => 10];

    public function __construct(private DiscordClient $discord) {}

    /**
     * In-app notification for each user; with `$dm`, also a Discord DM to those who linked
     * Discord and didn't mute the notice's category. A notice with a key reaches each user once.
     *
     * @param  User|iterable<User>  $users
     * @return int how many users it reached (not counting those who had it already)
     */
    public function toUsers(User|iterable $users, Notice $notice, bool $dm = false): int
    {
        $users = collect($users instanceof User ? [$users] : $users)->unique('id');
        $category = $notice->resolvedCategory();
        $reached = 0;

        foreach ($users as $user) {
            if ($notice->key && AppNotification::where('user_id', $user->id)->where('dedupe_key', $notice->key)->exists()) {
                continue;
            }

            $this->record($notice, ['user_id' => $user->id, 'channel' => 'web', 'status' => 'sent', 'sent_at' => now()]);
            $reached++;

            $link = $dm ? $user->discordLink : null;
            if ($link && $link->wants($notice->type, $category)) {
                $this->send($this->record($notice, ['user_id' => $user->id, 'channel' => 'discord_dm', 'target' => $link->discord_user_id]));
            }
        }

        return $reached;
    }

    /**
     * Post to a server channel: `backups` (#backup-needs) or `admin` (#admin-alerts). Pings the
     * notice's mentioned users who linked Discord, and the channel's role (DISCORD_ROLE_ADMIN).
     */
    public function toChannel(string $channel, Notice $notice): void
    {
        if ($notice->key && AppNotification::where('channel', 'discord_channel')->where('dedupe_key', "{$channel}:{$notice->key}")->exists()) {
            return;
        }

        $users = collect($notice->mentions)->unique('id')
            ->map(fn (User $user) => $user->loadMissing('discordLink')->discordLink?->discord_user_id)
            ->filter()->unique()->values()->all();
        $roles = array_values(array_filter([config("services.discord.roles.{$channel}")]));

        $this->send($this->record($notice, [
            'channel' => 'discord_channel',
            'dedupe_key' => $notice->key ? "{$channel}:{$notice->key}" : null,
            'target' => config("services.discord.channels.{$channel}"),
            'payload' => array_filter([...$notice->payload(), 'mentions' => array_filter(['users' => $users, 'roles' => $roles])]),
        ]));
    }

    /**
     * Someone signed up (email or Google) and waits for approval. Every sign-up shows in the bell;
     * the Discord DM and #admin-alerts post go out at most once per vidhelp.signup.alert_every_minutes,
     * so a flood of sign-ups can't flood Discord.
     */
    public function signupPending(User $user): void
    {
        $minutes = config('vidhelp.signup.alert_every_minutes');
        $alert = Cache::add('signup-pending-alert', true, now()->addMinutes($minutes));

        $notice = Notice::make('signup_pending', "Pendaftar baru: {$user->name}")
            ->body("{$user->email} menunggu persetujuan.")
            ->field('Nama', $user->name)
            ->field('Email', $user->email)
            ->field('Daftar lewat', $user->signup_source === 'google' ? 'Google' : 'Email')
            ->about($user)
            ->link('/admin/users', 'Tinjau pendaftar');

        if (! $alert) {
            $this->toUsers($this->admins(), $notice);

            return;
        }

        $notice->field('Berikutnya', "Pendaftar lain dalam {$minutes} menit ke depan hanya muncul di lonceng.");
        $this->toUsers($this->admins(), $notice, dm: true);
        $this->toChannel('admin', $notice);
    }

    /** Active admins and finance staff (finance has every admin right and follows payroll). */
    public function admins(): Collection
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

    /** Active admins, finance and operators. */
    public function staff(): Collection
    {
        return User::role(['admin', 'finance', 'operator'])->where('status', 'active')->with('discordLink')->get();
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
     * Deliver one Discord message now. Used after the response, by the retry job and by "resend".
     */
    public function deliver(string $notificationId): void
    {
        $notification = AppNotification::find($notificationId);
        if (! $notification || $notification->channel === 'web' || $notification->status === 'sent') {
            return;
        }

        $dm = $notification->channel === 'discord_dm';

        try {
            $channelId = $dm ? $this->dmChannel($notification->target) : $notification->target;
            $this->discord->postMessage($channelId, DiscordMessage::for($notification));

            $notification->update(['status' => 'sent', 'sent_at' => now(), 'attempts' => $notification->attempts + 1, 'error' => null]);
            if ($dm) {
                DiscordLink::where('discord_user_id', $notification->target)->whereNotNull('dm_blocked_at')->update(['dm_blocked_at' => null]);
            }
        } catch (Throwable $e) {
            $this->failed($notification, $e);
        }
    }

    /**
     * Retry Discord messages that failed or were never sent: up to 3 tries within a day,
     * waiting 2 then 10 minutes between them. Errors that can't change aren't retried.
     */
    public function retry(): int
    {
        if (! $this->discord->configured()) {
            return 0;
        }

        $due = AppNotification::whereIn('channel', ['discord_channel', 'discord_dm'])
            ->where('attempts', '<', self::MAX_ATTEMPTS)
            ->where('created_at', '>', now()->subDay())
            ->where(function ($q) {
                $q->where(fn ($q) => $q->where('status', 'pending')->where('created_at', '<', now()->subMinutes(2)));
                foreach (self::BACKOFF_MINUTES as $attempts => $minutes) {
                    $q->orWhere(fn ($q) => $q->where('status', 'failed')->where('attempts', $attempts)->where('updated_at', '<=', now()->subMinutes($minutes)));
                }
            })
            ->pluck('id');

        $due->each(fn (string $id) => $this->deliver($id));

        return $due->count();
    }

    /** An admin sends a failed or skipped message again, right now. */
    public function resend(AppNotification $notification): AppNotification
    {
        if (! $notification->target && $notification->channel === 'discord_channel') {
            $notification->update(['status' => 'skipped', 'error' => 'Channel Discord belum diatur.']);

            return $notification;
        }

        $notification->update(['status' => 'pending', 'error' => null]);
        $this->deliver($notification->id);

        return $notification->fresh();
    }

    /**
     * DM a password reset link to a user who linked Discord, after the response. It goes straight
     * to Discord and is never stored (no bell, no delivery row): the link opens their account.
     */
    public function passwordResetDm(User $user, string $path): void
    {
        $link = $user->discordLink;
        if (! $link || ! $this->discord->configured()) {
            return;
        }

        $minutes = config('auth.passwords.'.config('auth.defaults.passwords').'.expire');
        $notice = new AppNotification([
            'type' => 'password_reset',
            'title' => 'Atur ulang kata sandi',
            'body' => "Ada permintaan atur ulang kata sandi untuk akun VidHelp {$user->email}. Link ini berlaku {$minutes} menit. Kalau bukan kamu yang meminta, abaikan pesan ini; kata sandimu tidak berubah.",
            'link' => $path,
            'payload' => ['buttons' => [['label' => 'Atur ulang kata sandi', 'path' => $path]]],
        ]);
        $notice->created_at = now();

        $discordUserId = $link->discord_user_id;
        $message = DiscordMessage::for($notice);
        dispatch(static fn () => app(self::class)->sendDm($discordUserId, $message))->afterResponse();
    }

    /** One DM without a delivery row: a failure is only logged, not retried. */
    private function sendDm(string $discordUserId, array $message): void
    {
        try {
            $this->discord->postMessage($this->dmChannel($discordUserId), $message);
        } catch (Throwable $e) {
            report($e);
        }
    }

    /**
     * Send a sample DM right away (the "send me a test message" button). Returns the error, if any.
     */
    public function testDm(User $user): ?string
    {
        if (! $this->discord->configured()) {
            return 'Discord belum dikonfigurasi di server.';
        }

        $link = $user->discordLink;
        $sample = $this->sample('test', "Halo {$user->name}! 👋", 'Notifikasi VidHelp akan masuk ke sini, lengkap dengan detail dan tombol untuk membukanya.', [
            ['name' => 'Terhubung sebagai', 'value' => $link->discord_username ?? '-', 'inline' => true],
            ['name' => 'Kategori dimatikan', 'value' => collect($link->muted_categories ?? [])->map(fn ($c) => NotificationTypes::categoryLabel($c))->join(', ') ?: 'Tidak ada', 'inline' => true],
        ]);

        try {
            $this->discord->postMessage($this->dmChannel($link->discord_user_id), DiscordMessage::for($sample));
            $link->update(['dm_blocked_at' => null]);

            return null;
        } catch (Throwable $e) {
            report($e);
            if ($e instanceof DiscordException && $e->cannotDm()) {
                $link->update(['dm_blocked_at' => now()]);
            }

            return 'Discord menolak pesannya. Pastikan kamu sudah bergabung di server agensi dan mengizinkan pesan langsung dari anggota server.';
        }
    }

    /**
     * Post a sample message to a server channel (admin panel). Returns the error, if any.
     */
    public function testChannel(string $channel, User $by): ?string
    {
        $channelId = config("services.discord.channels.{$channel}");
        if (! $this->discord->configured() || ! $channelId) {
            return 'Bot atau channel Discord ini belum diatur di server.';
        }

        $roles = array_values(array_filter([config("services.discord.roles.{$channel}")]));
        $sample = $this->sample('test', 'Tes notifikasi VidHelp', "Dikirim oleh {$by->name} dari panel notifikasi. Kalau pesan ini muncul, channel sudah siap.", [
            ['name' => 'Channel', 'value' => $channel === 'admin' ? '#admin-alerts' : '#backup-needs', 'inline' => true],
            ['name' => 'Role yang di-ping', 'value' => $roles ? "<@&{$roles[0]}>" : 'Tidak ada', 'inline' => true],
        ], $roles);

        try {
            $this->discord->postMessage($channelId, DiscordMessage::for($sample));

            return null;
        } catch (Throwable $e) {
            return 'Discord menolak pesannya: '.DiscordException::describe($e).'. Pastikan bot ada di server dan boleh mengirim pesan di channel ini.';
        }
    }

    private function record(Notice $notice, array $attributes): AppNotification
    {
        return AppNotification::create([
            'type' => $notice->type,
            'dedupe_key' => $notice->key,
            'title' => $notice->title,
            'body' => $notice->body,
            'link' => $notice->link,
            'payload' => $notice->payload(),
            ...$attributes,
        ]);
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

    private function failed(AppNotification $notification, Throwable $e): void
    {
        $permanent = $e instanceof DiscordException && $e->permanent();
        $dm = $notification->channel === 'discord_dm';

        if ($dm && $e instanceof DiscordException) {
            if ($e->cannotDm()) {
                DiscordLink::where('discord_user_id', $notification->target)->update(['dm_blocked_at' => now()]);
            } elseif ($e->status === 404) {
                // The saved DM channel is gone: open a new one on the next try
                DiscordLink::where('discord_user_id', $notification->target)->update(['dm_channel_id' => null]);
                $permanent = false;
            }
        }

        $notification->update([
            'status' => 'failed',
            'attempts' => $permanent ? self::MAX_ATTEMPTS : $notification->attempts + 1,
            'error' => Str::limit($e->getMessage(), 250),
        ]);
    }

    /** An unsaved notification for test messages. */
    private function sample(string $type, string $title, string $body, array $fields, array $roles = []): AppNotification
    {
        $sample = new AppNotification([
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'link' => '/',
            'payload' => array_filter(['fields' => $fields, 'mentions' => $roles ? ['roles' => $roles] : null]),
        ]);
        $sample->created_at = now();

        return $sample;
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
}
