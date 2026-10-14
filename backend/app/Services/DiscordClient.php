<?php

namespace App\Services;

use App\Exceptions\DiscordException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;
use Throwable;

/**
 * The few Discord API calls VidHelp needs: bot messages to channels and DMs, the
 * agency server (guild), and the OAuth "Connect Discord" flow that tells us a user's
 * Discord id and lets the bot add them to the server.
 */
class DiscordClient
{
    private const API = 'https://discord.com/api/v10';

    /** A rate limit at most this long is waited out once; longer ones are left to the retry job. */
    private const MAX_WAIT_SECONDS = 2;

    /** Bot messages only work with a token; everything else stays in-app. */
    public function configured(): bool
    {
        return filled(config('services.discord.bot_token'));
    }

    public function canConnect(): bool
    {
        return filled(config('services.discord.client_id')) && filled(config('services.discord.client_secret'));
    }

    public function hasGuild(): bool
    {
        return $this->configured() && filled(config('services.discord.guild_id'));
    }

    /**
     * Post a message to a channel (a server channel or a DM channel). Throws on failure.
     */
    public function postMessage(string $channelId, array $message): void
    {
        $this->call(fn () => $this->bot()->post(self::API."/channels/{$channelId}/messages", $message));
    }

    /**
     * The DM channel between the bot and a user (Discord returns the same one every time).
     */
    public function openDm(string $discordUserId): string
    {
        return $this->call(fn () => $this->bot()->post(self::API.'/users/@me/channels', ['recipient_id' => $discordUserId]))->json('id');
    }

    /** The agency server's name and member count; throws when the bot can't see it. */
    public function guild(): array
    {
        return $this->call(fn () => $this->bot()->get(self::API.'/guilds/'.config('services.discord.guild_id'), ['with_counts' => 'true']))->json();
    }

    /** A channel's name; throws when the bot can't see it. */
    public function channel(string $channelId): array
    {
        return $this->call(fn () => $this->bot()->get(self::API."/channels/{$channelId}"))->json();
    }

    /** Whether the user is in the agency server (null when that can't be checked). */
    public function inGuild(string $discordUserId): ?bool
    {
        if (! $this->hasGuild()) {
            return null;
        }

        try {
            $response = $this->bot()->get(self::API.'/guilds/'.config('services.discord.guild_id')."/members/{$discordUserId}");
        } catch (Throwable $e) {
            report($e);

            return null;
        }

        return match (true) {
            $response->successful() => true,
            $response->status() === 404 => false,
            default => null,
        };
    }

    /**
     * Add the user to the agency server with their OAuth token (no-op if already a member),
     * so the bot shares a server with them and can DM them.
     */
    public function addToGuild(string $discordUserId, string $accessToken): void
    {
        $this->call(fn () => $this->bot()->put(
            self::API.'/guilds/'.config('services.discord.guild_id')."/members/{$discordUserId}",
            ['access_token' => $accessToken],
        ));
    }

    /**
     * Discord's consent page for linking an account: reads the user's id and name and,
     * with a server set, lets the bot add them to it.
     */
    public function authorizeUrl(string $state): string
    {
        return 'https://discord.com/oauth2/authorize?'.http_build_query([
            'client_id' => config('services.discord.client_id'),
            'redirect_uri' => config('services.discord.redirect'),
            'response_type' => 'code',
            'scope' => $this->hasGuild() ? 'identify guilds.join' : 'identify',
            'state' => $state,
        ]);
    }

    /**
     * Turn the code from the consent page into the Discord user and their access token.
     *
     * @return array{0: array{id: string, username: string, global_name?: string|null}, 1: string}
     */
    public function userFromCode(string $code): array
    {
        $token = Http::asForm()->acceptJson()->timeout(10)
            ->post('https://discord.com/api/oauth2/token', [
                'client_id' => config('services.discord.client_id'),
                'client_secret' => config('services.discord.client_secret'),
                'grant_type' => 'authorization_code',
                'code' => $code,
                'redirect_uri' => config('services.discord.redirect'),
            ])
            ->throw()
            ->json('access_token');

        $user = Http::withToken($token)->acceptJson()->timeout(10)->get(self::API.'/users/@me')->throw()->json();

        return [$user, $token];
    }

    /**
     * Send a request, waiting out one short rate limit. Throws DiscordException on an error.
     *
     * @param  callable(): Response  $request
     */
    private function call(callable $request): Response
    {
        $response = $request();

        if ($response->status() === 429) {
            $wait = (float) ($response->json('retry_after') ?? self::MAX_WAIT_SECONDS + 1);
            if ($wait <= self::MAX_WAIT_SECONDS) {
                Sleep::for((int) ceil($wait * 1000))->milliseconds();
                $response = $request();
            }
        }

        if ($response->failed()) {
            throw DiscordException::from($response);
        }

        return $response;
    }

    private function bot(): PendingRequest
    {
        return Http::withToken(config('services.discord.bot_token'), 'Bot')->acceptJson()->timeout(10);
    }
}
