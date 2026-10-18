<?php

namespace App\Services;

use App\Exceptions\DiscordException;
use App\Models\BackupRequest;
use App\Models\DiscordLink;
use App\Models\HostProfile;
use App\Models\PointBalance;
use App\Models\PointLog;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Throwable;

/**
 * The bot's slash commands: how they look in Discord (registered with
 * `php artisan discord:register-commands`) and what they answer.
 *
 * Discord wants a response within 3 seconds, so a command first shows "VidHelp is thinking…"
 * and the answer replaces it after the response. Only the person who typed a command sees
 * its answer, so hosts can ask about their own schedule, points and pay in any channel.
 */
class DiscordCommands
{
    /** Host commands: name => what Discord shows under it. */
    public const HOST_COMMANDS = [
        'jadwal' => 'Jadwal live kamu hari ini dan besok',
        'backup' => 'Backup yang masih bisa kamu daftar',
        'poin' => 'Poin dan SP kamu periode ini',
        'gaji' => 'Perkiraan gaji kamu dari periode yang sedang berjalan',
    ];

    /** Discord permission bits */
    private const ADMINISTRATOR = 1 << 3;

    private const VIEW_CHANNEL = 1 << 10;

    private const MANAGE_MESSAGES = 1 << 13;

    private const READ_MESSAGE_HISTORY = 1 << 16;

    /** Message flag: only the person who typed the command sees it */
    private const EPHEMERAL = 1 << 6;

    /** /clear stops after this long and says to run it again; the reply token lasts 15 minutes. */
    private const CLEAR_SECONDS = 12 * 60;

    /** /backup lists at most this many; the Backup page has the rest. */
    private const BACKUP_ROWS = 10;

    public function __construct(
        private DiscordClient $discord,
        private AttendanceService $attendance,
        private BackupService $backups,
        private PayrollService $payroll,
        private PointService $points,
    ) {}

    /** The commands as Discord registers them. */
    public function definitions(): array
    {
        return [
            ...collect(self::HOST_COMMANDS)->map(fn (string $description, string $name) => ['name' => $name, 'description' => $description])->values()->all(),
            [
                'name' => 'clear',
                'description' => 'Hapus pesan di channel ini (pesan yang di-pin tetap ada)',
                // Shown to members who can delete messages; server admins can change who sees it
                'default_member_permissions' => (string) self::MANAGE_MESSAGES,
                'options' => [[
                    'type' => 4, // integer
                    'name' => 'jumlah',
                    'description' => 'Berapa pesan terbaru yang dihapus. Kosongkan untuk menghapus semua.',
                    'min_value' => 1,
                    'max_value' => 10000,
                ]],
            ],
        ];
    }

    /**
     * The immediate response to a slash command: a problem the user can fix right away,
     * or "thinking…" while the answer is worked out after the response.
     */
    public function respond(array $interaction): array
    {
        $name = $interaction['data']['name'] ?? '';
        $token = $interaction['token'];

        if ($name === 'clear') {
            return $this->startClear($interaction);
        }
        if (! array_key_exists($name, self::HOST_COMMANDS)) {
            return $this->reply($this->text('Command ini tidak dikenal. Coba ketik / untuk melihat daftar command VidHelp.'));
        }

        $discordId = $interaction['member']['user']['id'] ?? $interaction['user']['id'] ?? null;
        $user = DiscordLink::where('discord_user_id', $discordId)->first()?->user;

        if (! $user) {
            return $this->reply($this->text('🔗 Akun Discord kamu belum terhubung ke VidHelp. Buka **Profil** di VidHelp, lalu pilih **Hubungkan Discord**.'));
        }
        if ($reason = $user->loginBlockedReason()) {
            return $this->reply($this->text("🔒 {$reason}"));
        }
        if (! $user->hostProfile) {
            return $this->reply($this->text('Command ini khusus untuk host.'));
        }

        $hostId = $user->hostProfile->id;
        dispatch(static fn () => app(self::class)->answer($token, $name, $hostId))->afterResponse();

        return $this->thinking();
    }

    /** Work out a host command's answer and put it in place of "thinking…". */
    public function answer(string $token, string $command, string $hostId): void
    {
        try {
            $host = HostProfile::with('user')->findOrFail($hostId);
            $message = match ($command) {
                'jadwal' => $this->schedule($host),
                'backup' => $this->backupNeeds($host),
                'poin' => $this->pointsSummary($host),
                'gaji' => $this->pay($host),
            };
        } catch (Throwable $e) {
            report($e);
            $message = $this->text('⚠️ Maaf, VidHelp sedang bermasalah. Coba lagi sebentar lagi.');
        }

        $this->finish($token, $message);
    }

    /** Today's and tomorrow's sessions: own slots, covers, event blocks, and the ones someone covers. */
    private function schedule(HostProfile $host): array
    {
        $today = CarbonImmutable::today();
        $days = [$today, $today->addDay()];

        // A session that started last night and is still running counts as today's
        $sessions = $this->attendance->sessions($host, $today, $today->addDays(2))
            ->groupBy(fn (array $session) => $session['start_at']->max($today)->toDateString());

        $fields = collect($days)->map(fn (CarbonImmutable $day, int $i) => [
            'name' => ($i === 0 ? 'Hari ini' : 'Besok').' · '.$day->translatedFormat('l, j F'),
            'value' => Str::limit($sessions->get($day->toDateString(), collect())->map($this->sessionLine(...))->join("\n"), 1000) ?: 'Tidak ada jadwal.',
            'inline' => false,
        ])->all();

        return $this->embed('📅 Jadwal kamu', null, $fields, NotificationTypes::BLUE, [['label' => 'Buka jadwal', 'path' => '/host/schedule']]);
    }

    /** "🎥 **Brand A** · 14:00–16:00 · 🔴 sedang live", in the reader's own time zone. */
    private function sessionLine(array $session): string
    {
        $time = "<t:{$session['start_at']->getTimestamp()}:t>–<t:{$session['end_at']->getTimestamp()}:t>";
        $brand = $session['brand']['name'];

        if ($session['role'] === 'off') {
            return "➖ ~~{$brand} · {$time}~~ · digantikan ".($session['covered_by'] ?? 'host lain');
        }

        $line = match ($session['role']) {
            'cover' => "🤝 **{$brand}** · {$time} · menggantikan {$session['covered_for']}",
            'event' => "🎪 **{$brand}** · {$session['event_name']} · {$time}",
            default => "🎥 **{$brand}** · {$time}",
        };

        $attendance = $session['attendance'];
        $state = match (true) {
            $attendance?->check_out_at !== null => '✅ selesai',
            $attendance?->check_in_at !== null => '🔴 sedang live',
            now()->gte($session['end_at']) => '⚠️ tidak check-in',
            now()->gte($session['start_at']) => '⏰ belum check-in',
            default => null,
        };

        return $state ? "{$line} · {$state}" : $line;
    }

    /** Other hosts' upcoming backups this host can apply for (or already did), the ones naming them first. */
    private function backupNeeds(HostProfile $host): array
    {
        $needs = BackupRequest::whereIn('status', ['open', 'pending'])
            ->where('start_at', '>', now())
            ->where('requesting_host_id', '!=', $host->id)
            ->with(['brand:id,name', 'requester.user', 'nominees', 'applications' => fn ($q) => $q->where('applicant_host_id', $host->id)->where('status', 'applied')])
            ->orderBy('start_at')
            ->get()
            ->filter(fn (BackupRequest $backup) => $backup->applications->isNotEmpty() || $this->backups->ineligibleReason($host, $backup) === null)
            ->sortByDesc(fn (BackupRequest $backup) => $backup->nominees->contains('nominee_host_id', $host->id))
            ->values();

        $lines = $needs->take(self::BACKUP_ROWS)->map(fn (BackupRequest $backup) => implode(' · ', array_filter([
            "**{$backup->brand->name}**",
            "<t:{$backup->start_at->getTimestamp()}:f>–<t:{$backup->end_at->getTimestamp()}:t>",
            "untuk {$backup->requester->user->name}",
            $backup->nominees->contains('nominee_host_id', $host->id) ? '🙏 kamu diminta' : null,
            $backup->applications->isNotEmpty() ? '✅ sudah daftar' : null,
        ])));

        if ($needs->count() > self::BACKUP_ROWS) {
            $lines->push('…dan '.($needs->count() - self::BACKUP_ROWS).' lainnya di VidHelp.');
        }

        return $this->embed(
            '🆘 Backup yang bisa kamu daftar',
            $lines->join("\n") ?: 'Belum ada backup yang bisa kamu daftar saat ini.',
            [],
            NotificationTypes::BLUE,
            [['label' => 'Buka Backup', 'path' => '/host/backups']],
        );
    }

    /** Points this period (read without starting a balance), the SP level, and the last deductions. */
    private function pointsSummary(HostProfile $host): array
    {
        [$start, $end] = $this->points->periodFor(today());
        $opening = (int) config('vidhelp.points.starting_points');
        $balance = PointBalance::where('host_id', $host->id)->whereDate('period_start', $start)->first();
        $points = $balance->current_points ?? $opening;
        $level = $this->points->currentLevel($host);
        $nextThreshold = config('vidhelp.points.sp_thresholds.'.($level + 1));

        $deductions = PointLog::counting()
            ->where('host_id', $host->id)
            ->whereDate('period_start', $start)
            ->where('points_change', '<', 0)
            ->with(['violationType', 'brandComplaint.brand'])
            ->latest('occurred_on')
            ->limit(3)
            ->get()
            ->map(fn (PointLog $log) => implode(' · ', array_filter([$log->points_change, $log->label(), $log->occurred_on?->translatedFormat('j M')])));

        $fields = [
            ['name' => 'Poin', 'value' => "**{$points}** dari {$opening}", 'inline' => true],
            ['name' => 'SP', 'value' => $level ? "SP{$level}" : 'Tidak ada', 'inline' => true],
            ['name' => 'Periode', 'value' => $start->translatedFormat('j M').' – '.$end->translatedFormat('j M Y'), 'inline' => true],
        ];
        if ($nextThreshold !== null && $points > $nextThreshold) {
            $fields[] = ['name' => 'SP berikutnya', 'value' => 'SP'.($level + 1)." kalau poin turun ke {$nextThreshold}", 'inline' => false];
        }
        if ($deductions->isNotEmpty()) {
            $fields[] = ['name' => 'Potongan terakhir', 'value' => $deductions->join("\n"), 'inline' => false];
        }

        return $this->embed('📊 Poin kamu', null, $fields, $level ? NotificationTypes::RED : NotificationTypes::GREEN, [['label' => 'Lihat detail', 'path' => '/host/rating']]);
    }

    /** The estimate for each running pay period the host has hours in, and the kasbon left to repay. */
    private function pay(HostProfile $host): array
    {
        $periods = $this->payroll->hostOpenPeriods($host);
        $advance = $this->payroll->outstandingAdvances($host);

        $fields = $periods->take(10)->map(fn (array $period) => [
            'name' => Str::limit($period['brand']['name'].' · sejak '.CarbonImmutable::parse($period['period_start'])->translatedFormat('j M'), 250),
            'value' => self::hours($period['hours']).' × '.self::rupiah($period['rate_per_hour']).' = **'.self::rupiah($period['estimate'])."**\n"
                .($period['status'] === 'waiting_payment'
                    ? 'Target tercapai, menunggu pembayaran'
                    : 'Target brand: '.self::hours($period['brand_hours']).' dari '.self::hours($period['target_hours'])),
            'inline' => false,
        ])->all();

        if ($advance > 0) {
            $fields[] = ['name' => 'Sisa kasbon', 'value' => self::rupiah($advance), 'inline' => false];
        }

        $description = $periods->isEmpty()
            ? 'Belum ada jam yang disetujui di periode yang sedang berjalan.'
            : 'Perkiraan total: **'.self::rupiah($periods->sum('estimate'))."**\nMemakai tarifmu saat ini. Jumlah akhir ditetapkan saat agensi mengajukan pembayaran.";

        return $this->embed('💰 Gaji kamu', $description, $fields, NotificationTypes::GREEN, [['label' => 'Buka Gaji', 'path' => '/host/pay']]);
    }

    /**
     * /clear: refuse right away when someone may not use it or the bot can't, otherwise
     * start clearing after the response. One run per channel at a time.
     */
    private function startClear(array $interaction): array
    {
        $channelId = $interaction['channel_id'] ?? $interaction['channel']['id'] ?? null;
        if (! isset($interaction['guild_id'], $interaction['member']) || ! $channelId) {
            return $this->reply($this->text('Command ini hanya bisa dipakai di channel server.'));
        }
        if (! self::allows($interaction['member']['permissions'] ?? '0', self::MANAGE_MESSAGES)) {
            return $this->reply($this->text('🔒 Kamu butuh izin **Manage Messages** di channel ini untuk memakai /clear.'));
        }
        if (! self::allows($interaction['app_permissions'] ?? '0', self::VIEW_CHANNEL | self::MANAGE_MESSAGES | self::READ_MESSAGE_HISTORY)) {
            return $this->reply($this->text('🔒 Bot butuh izin **View Channel**, **Manage Messages**, dan **Read Message History** di channel ini. Atur di pengaturan channel atau role bot.'));
        }
        if (! Cache::add(self::clearLock($channelId), true, self::CLEAR_SECONDS + 60)) {
            return $this->reply($this->text('⏳ Channel ini sedang dibersihkan. Tunggu sampai selesai.'));
        }

        $token = $interaction['token'];
        $limit = collect($interaction['data']['options'] ?? [])->firstWhere('name', 'jumlah')['value'] ?? null;
        // Shown in the server's audit log next to the bot's deletions
        $reason = '/clear oleh '.($interaction['member']['user']['username'] ?? 'seseorang');
        dispatch(static fn () => app(self::class)->clear($token, $channelId, $limit, $reason))->afterResponse();

        return $this->thinking();
    }

    /**
     * Delete the channel's newest messages (all of them without a limit), keeping pinned ones.
     * Messages under two weeks old go 100 at a time; older ones one by one, which is slow, so it
     * stops after CLEAR_SECONDS and says to run it again.
     */
    public function clear(string $token, string $channelId, ?int $limit, string $reason): void
    {
        $deadline = now()->addSeconds(self::CLEAR_SECONDS);
        // Bulk delete refuses messages of 14 days or older; keep a margin
        $bulkAfter = now()->subDays(14)->addHour();
        $deleted = 0;
        $pinned = 0;
        $before = null;
        $finished = false;
        $failed = false;

        try {
            do {
                $batch = collect($this->discord->messages($channelId, $before));
                $before = $batch->last()['id'] ?? null;
                $pinned += $batch->where('pinned', true)->count();

                $ids = $batch->reject(fn (array $message) => $message['pinned'] ?? false)->pluck('id');
                if ($limit !== null) {
                    $ids = $ids->take($limit - $deleted);
                }
                [$recent, $old] = $ids->partition(fn (string $id) => self::sentAt($id)->gt($bulkAfter));

                if ($recent->count() > 1) {
                    $this->discord->bulkDelete($channelId, $recent->values()->all(), $reason);
                } elseif ($recent->count() === 1) {
                    $this->deleteOne($channelId, $recent->first(), $reason);
                }
                $deleted += $recent->count();

                foreach ($old as $id) {
                    if (now()->gte($deadline)) {
                        break 2;
                    }
                    $this->deleteOne($channelId, $id, $reason);
                    $deleted++;
                }

                $finished = $batch->count() < 100 || ($limit !== null && $deleted >= $limit);
            } while (! $finished && now()->lt($deadline));
        } catch (Throwable $e) {
            report($e);
            $failed = true;
        } finally {
            Cache::forget(self::clearLock($channelId));
        }

        $lines = [$deleted ? "🧹 **{$deleted}** pesan dihapus." : 'Tidak ada pesan yang bisa dihapus.'];
        if ($pinned) {
            $lines[] = "📌 {$pinned} pesan yang di-pin tidak dihapus.";
        }
        if ($failed) {
            $lines[] = '⚠️ Berhenti karena Discord menolak permintaannya. Coba jalankan /clear lagi.';
        } elseif (! $finished) {
            $lines[] = '⏳ Masih ada pesan yang belum terhapus. Pesan di atas 2 minggu harus dihapus satu per satu, jadi jalankan /clear lagi untuk melanjutkan.';
        }

        $this->finish($token, $this->text(implode("\n", $lines)));
    }

    /** Delete one message; one that is already gone counts as deleted. */
    private function deleteOne(string $channelId, string $messageId, string $reason): void
    {
        try {
            $this->discord->deleteMessage($channelId, $messageId, $reason);
        } catch (DiscordException $e) {
            if ($e->status !== 404) {
                throw $e;
            }
        }
    }

    private function finish(string $token, array $message): void
    {
        try {
            $this->discord->editReply($token, $message);
        } catch (Throwable $e) {
            report($e);
        }
    }

    /** Whether a permission set (Discord sends it as a string) has all of these bits; administrators have every one. */
    private static function allows(string $permissions, int $bits): bool
    {
        $permissions = (int) $permissions;

        return ($permissions & self::ADMINISTRATOR) !== 0 || ($permissions & $bits) === $bits;
    }

    /** When a message was sent, read from its id (a Discord snowflake). */
    private static function sentAt(string $id): CarbonImmutable
    {
        return CarbonImmutable::createFromTimestampMs(((int) $id >> 22) + 1420070400000);
    }

    private static function clearLock(string $channelId): string
    {
        return "discord-clear:{$channelId}";
    }

    /** "VidHelp is thinking…", replaced by the answer later. */
    private function thinking(): array
    {
        return ['type' => 5, 'data' => ['flags' => self::EPHEMERAL]];
    }

    private function reply(array $message): array
    {
        return ['type' => 4, 'data' => [...$message, 'flags' => self::EPHEMERAL]];
    }

    private function text(string $content): array
    {
        return ['content' => $content, 'allowed_mentions' => ['parse' => []]];
    }

    /** @param  list<array{label: string, path: string}>  $buttons */
    private function embed(string $title, ?string $description, array $fields, int $color, array $buttons = []): array
    {
        $message = [
            'embeds' => [array_filter([
                'title' => $title,
                'description' => $description ? Str::limit($description, 4000) : null,
                'color' => $color,
                'fields' => $fields,
                'footer' => ['text' => 'VidHelp'],
            ])],
            'allowed_mentions' => ['parse' => []],
        ];

        if ($row = DiscordMessage::linkButtons($buttons)) {
            $message['components'] = [['type' => 1, 'components' => $row]];
        }

        return $message;
    }

    private static function rupiah(float|int|null $amount): string
    {
        return 'Rp '.number_format((float) $amount, 0, ',', '.');
    }

    /** "12,5 jam" */
    private static function hours(float|int|null $hours): string
    {
        return rtrim(rtrim(number_format((float) $hours, 2, ',', '.'), '0'), ',').' jam';
    }
}
