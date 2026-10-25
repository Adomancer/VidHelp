<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\DiscordLink;
use App\Models\User;
use App\Services\DiscordClient;
use App\Services\NotificationTypes;
use App\Services\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * "Connect Discord" so the bot can send me direct messages, and which ones I want.
 */
class DiscordController extends Controller
{
    private const STATE_CACHE_PREFIX = 'discord-oauth-state:';

    /** How long the consent page may take before its state is no longer accepted. */
    private const STATE_MINUTES = 10;

    public function __construct(private DiscordClient $discord) {}

    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'available' => $this->discord->canConnect() && $this->discord->configured(),
            'link' => $user->discordLink ? $this->linkData($user->discordLink) : null,
            'categories' => $this->categories($user),
        ]);
    }

    /**
     * The Discord consent page. Its `state` belongs to this user and is used once by link(), so a
     * code from someone else's consent page can't link their Discord to this account (password
     * reset links go out by Discord DM).
     */
    public function connectUrl(Request $request): JsonResponse
    {
        abort_unless($this->discord->canConnect(), 503, 'Discord belum dikonfigurasi di server.');

        $state = Str::random(40);
        Cache::put(self::STATE_CACHE_PREFIX.$state, $request->user()->id, now()->addMinutes(self::STATE_MINUTES));

        return response()->json(['url' => $this->discord->authorizeUrl($state), 'state' => $state]);
    }

    /**
     * Finish linking with the code Discord sent back to the frontend, and add the user to
     * the agency server so the bot can DM them. Staff start with staff alerts muted (they
     * also go to #admin-alerts).
     */
    public function link(Request $request, Notifier $notifier): JsonResponse
    {
        $request->validate(['code' => 'required|string|max:200', 'state' => 'required|string|max:100']);
        $user = $request->user();

        if (Cache::pull(self::STATE_CACHE_PREFIX.$request->state) !== $user->id) {
            throw ValidationException::withMessages(['code' => ['Sesi menghubungkan Discord sudah kedaluwarsa. Silakan coba lagi.']]);
        }

        try {
            [$discordUser, $accessToken] = $this->discord->userFromCode($request->code);
        } catch (Throwable $e) {
            report($e);
            throw ValidationException::withMessages(['code' => ['Discord tidak menerima proses masuk. Silakan coba lagi.']]);
        }

        $taken = DiscordLink::where('discord_user_id', $discordUser['id'])->where('user_id', '!=', $user->id)->exists();
        if ($taken) {
            throw ValidationException::withMessages(['code' => ['Akun Discord ini sudah terhubung ke pengguna VidHelp lain.']]);
        }

        if ($this->discord->hasGuild()) {
            try {
                $this->discord->addToGuild($discordUser['id'], $accessToken);
            } catch (Throwable $e) {
                report($e); // Linking still works; the card shows they aren't in the server yet
            }
        }

        $existing = $user->discordLink;
        $link = DiscordLink::updateOrCreate(
            ['user_id' => $user->id],
            [
                'discord_user_id' => $discordUser['id'],
                'discord_username' => $discordUser['global_name'] ?? $discordUser['username'],
                'dm_channel_id' => null,
                'dm_blocked_at' => null,
                'muted_categories' => $existing?->muted_categories ?? ($user->hasRole('host') ? [] : NotificationTypes::STAFF_MUTED_BY_DEFAULT),
                'linked_at' => now(),
            ]
        );
        $user->setRelation('discordLink', $link);
        Cache::forget($this->guildCacheKey($link));
        AuditLog::record('discord_linked', $user, new: ['discord_user_id' => $discordUser['id'], 'discord_username' => $link->discord_username], actor: $user);
        $notifier->discordLinked($user, $link, $existing?->discord_user_id);

        return response()->json(['link' => $this->linkData($link), 'message' => 'Discord terhubung']);
    }

    public function unlink(Request $request): JsonResponse
    {
        $request->user()->discordLink()->delete();
        $request->user()->unsetRelation('discordLink');

        return response()->json(['message' => 'Discord diputuskan']);
    }

    /** Which categories reach me as DMs (the bell always shows everything). */
    public function preferences(Request $request): JsonResponse
    {
        $user = $request->user();
        $link = $user->discordLink;
        abort_unless($link, 422, 'Hubungkan Discord dulu.');

        $data = $request->validate([
            'muted' => 'present|array',
            'muted.*' => ['string', Rule::in(NotificationTypes::categoriesFor($user->getRoleNames()))],
        ]);

        $link->update(['muted_categories' => array_values(array_unique($data['muted']))]);

        return response()->json(['link' => $this->linkData($link), 'message' => 'Pengaturan notifikasi disimpan']);
    }

    /** Send a direct message now, to check the user can receive them. */
    public function test(Request $request, Notifier $notifier): JsonResponse
    {
        $user = $request->user()->load('discordLink');
        abort_unless($user->discordLink, 422, 'Hubungkan Discord dulu.');

        $error = $notifier->testDm($user);
        Cache::forget($this->guildCacheKey($user->discordLink));

        return $error
            ? response()->json(['message' => $error], 422)
            : response()->json(['message' => 'Terkirim! Cek pesan langsung di Discord kamu.']);
    }

    private function linkData(DiscordLink $link): array
    {
        return [
            'discord_username' => $link->discord_username,
            'linked_at' => $link->linked_at,
            'muted' => $link->muted_categories ?? [],
            'dm_blocked' => $link->dm_blocked_at !== null,
            // Checked against Discord at most every 10 minutes; null when there's no server to check
            'in_guild' => Cache::remember($this->guildCacheKey($link), now()->addMinutes(10), fn () => $this->discord->inGuild($link->discord_user_id)),
        ];
    }

    /** @return list<array{key: string, label: string}> */
    private function categories(User $user): array
    {
        return collect(NotificationTypes::categoriesFor($user->getRoleNames()))
            ->map(fn (string $key) => ['key' => $key, 'label' => NotificationTypes::categoryLabel($key)])
            ->all();
    }

    private function guildCacheKey(DiscordLink $link): string
    {
        return "discord-in-guild:{$link->discord_user_id}";
    }
}
