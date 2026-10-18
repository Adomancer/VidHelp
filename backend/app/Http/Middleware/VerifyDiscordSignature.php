<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Only let through requests Discord signed with the app's key (Developer Portal → General
 * Information → Public Key). Discord also sends unsigned ones when the endpoint is saved,
 * to check they get refused.
 */
class VerifyDiscordSignature
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(function_exists('sodium_crypto_sign_verify_detached'), 500, 'Aktifkan ekstensi PHP sodium (extension=sodium di php.ini).');

        $key = (string) config('services.discord.public_key');
        $signature = (string) $request->header('X-Signature-Ed25519');
        $timestamp = (string) $request->header('X-Signature-Timestamp');

        $valid = strlen($key) === 64 && ctype_xdigit($key)
            && strlen($signature) === 128 && ctype_xdigit($signature)
            && $timestamp !== ''
            && sodium_crypto_sign_verify_detached(hex2bin($signature), $timestamp.$request->getContent(), hex2bin($key));

        abort_unless($valid, 401, 'Invalid request signature');

        return $next($request);
    }
}
