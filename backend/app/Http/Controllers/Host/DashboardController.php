<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use App\Services\DiscordClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    public function __construct(private DashboardService $dashboard, private DiscordClient $discord) {}

    /**
     * My overview: this week's sessions, what I still have to do, backups I could take, pay, points and rating.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $host = $user->hostProfile ?? abort(404, 'Kamu tidak punya profil host.');

        return response()->json([
            ...$this->dashboard->host($host),
            // Reminders reach me on Discord: nudge to connect, where it can be connected
            'discord_unlinked' => $this->discord->canConnect() && $this->discord->configured() && ! $user->discordLink,
        ]);
    }
}
