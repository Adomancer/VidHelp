<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

/**
 * The few Discord API calls VidHelp needs: bot messages to channels and DMs,
 * and the OAuth "Connect Discord" flow that tells us a user's Discord id.
 */
class DiscordClient
{
    private const API = 'https://discord.com/api/v10';

    /** Bot messages only work with a token; everything else stays in-app. */
    public function configured(): bool
    {
        return filled(config('services.discord.bot_token'));
    }

    public function canConnect(): bool
    {
        return filled(config('services.discord.client_id')) && filled(config('services.discord.client_secret'));
    }

    /**
     * Post a message to a channel (a server channel or a DM channel). Throws on failure.
     */
    public function postMessage(string $channelId, array $message): void
    {
        $this->bot()->post(self::API."/channels/{$channelId}/messages", $message)->throw();
    }

    /**
     * The DM channel between the bot and a user (Discord returns the same one every time).
     */
    public function openDm(string $discordUserId): string
    {
        return $this->bot()->post(self::API.'/users/@me/channels', ['recipient_id' => $discordUserId])->throw()->json('id');
    }

    /** Discord's consent page for linking an account (only reads the user's id and name). */
    public function authorizeUrl(string $state): string
    {
        return 'https://discord.com/oauth2/authorize?'.http_build_query([
            'client_id' => config('services.discord.client_id'),
            'redirect_uri' => config('services.discord.redirect'),
            'response_type' => 'code',
            'scope' => 'identify',
            'state' => $state,
        ]);
    }

    /**
     * Turn the code from the consent page into the Discord user.
     *
     * @return array{id: string, username: string, global_name?: string|null}
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

        return Http::withToken($token)->acceptJson()->timeout(10)->get(self::API.'/users/@me')->throw()->json();
    }

    private function bot()
    {
        return Http::withToken(config('services.discord.bot_token'), 'Bot')->acceptJson()->timeout(10);
    }
}
