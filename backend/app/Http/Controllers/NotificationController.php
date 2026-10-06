<?php

namespace App\Http\Controllers;

use App\Models\AppNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * My in-app notifications (the bell).
 */
class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $mine = AppNotification::where('user_id', $request->user()->id)->where('channel', 'web');

        return response()->json([
            'notifications' => (clone $mine)->latest()->limit(30)->get(['id', 'type', 'title', 'body', 'link', 'read_at', 'created_at']),
            'unread' => (clone $mine)->whereNull('read_at')->count(),
        ]);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        return response()->json([
            'unread' => AppNotification::where('user_id', $request->user()->id)->where('channel', 'web')->whereNull('read_at')->count(),
        ]);
    }

    public function read(Request $request, AppNotification $notification): JsonResponse
    {
        abort_unless($notification->user_id === $request->user()->id && $notification->channel === 'web', 404);

        $notification->update(['read_at' => $notification->read_at ?? now()]);

        return response()->json(['message' => 'Ditandai sudah dibaca']);
    }

    public function readAll(Request $request): JsonResponse
    {
        AppNotification::where('user_id', $request->user()->id)->where('channel', 'web')->whereNull('read_at')->update(['read_at' => now()]);

        return response()->json(['message' => 'Semua ditandai sudah dibaca']);
    }
}
