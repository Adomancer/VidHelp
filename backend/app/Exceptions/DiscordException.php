<?php

namespace App\Exceptions;

use Illuminate\Http\Client\Response;
use RuntimeException;

/**
 * Discord answered with an error. `permanent` errors (bad request, no access, unknown
 * channel or user) come back the same on every retry; rate limits and outages don't.
 */
class DiscordException extends RuntimeException
{
    /** "Cannot send messages to this user": DMs closed, or not in a server with the bot. */
    public const CANNOT_DM = 50007;

    public function __construct(string $message, public readonly int $status, public readonly ?int $discordCode = null)
    {
        parent::__construct($message);
    }

    public static function from(Response $response): self
    {
        $code = $response->json('code');

        return new self(
            "Discord {$response->status()}: ".($response->json('message') ?? 'tanpa keterangan'),
            $response->status(),
            is_int($code) ? $code : null,
        );
    }

    public function permanent(): bool
    {
        return in_array($this->status, [400, 401, 403, 404], true);
    }

    public function cannotDm(): bool
    {
        return $this->discordCode === self::CANNOT_DM;
    }
}
