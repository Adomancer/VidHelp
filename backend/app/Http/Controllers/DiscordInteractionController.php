<?php

namespace App\Http\Controllers;

use App\Services\DiscordCommands;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Discord's Interactions Endpoint: it posts here when someone uses a slash command.
 */
class DiscordInteractionController extends Controller
{
    private const PING = 1;

    private const APPLICATION_COMMAND = 2;

    public function __invoke(Request $request, DiscordCommands $commands): JsonResponse
    {
        $response = match ($request->integer('type')) {
            self::PING => response()->json(['type' => self::PING]), // Discord checking the endpoint
            self::APPLICATION_COMMAND => response()->json($commands->respond($request->json()->all())),
            default => response()->json(['message' => 'Unsupported interaction'], 400),
        };

        // With a length, Discord has the whole response before the work after it (e.g. /clear) is
        // done, also on servers that can't end the request early like `php artisan serve`
        return $response->header('Content-Length', (string) strlen($response->getContent()));
    }
}
