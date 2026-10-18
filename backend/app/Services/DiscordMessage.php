<?php

namespace App\Services;

use App\Models\AppNotification;
use Illuminate\Support\Str;

/**
 * Turns a stored notification into a Discord message: an embed colored by type with the
 * brand, fields and photo, link buttons back to VidHelp, and the pings.
 */
class DiscordMessage
{
    public static function for(AppNotification $notification): array
    {
        $payload = $notification->payload ?? [];
        $category = $payload['category'] ?? NotificationTypes::category($notification->type);

        $embed = array_filter([
            'author' => isset($payload['brand']) ? ['name' => Str::limit($payload['brand'], 250)] : null,
            'title' => Str::limit(NotificationTypes::emoji($notification->type).' '.$notification->title, 250),
            'description' => $notification->body ? Str::limit($notification->body, 3500) : null,
            'url' => self::url($notification->link),
            'color' => NotificationTypes::color($notification->type),
            'fields' => collect($payload['fields'] ?? [])->take(25)->map(fn (array $field) => [
                'name' => Str::limit($field['name'], 250),
                'value' => Str::limit($field['value'], 1000),
                'inline' => $field['inline'] ?? true,
            ])->all(),
            'thumbnail' => self::isPublic($payload['thumbnail'] ?? null) ? ['url' => $payload['thumbnail']] : null,
            'footer' => ['text' => 'VidHelp · '.NotificationTypes::categoryLabel($category)],
            'timestamp' => $notification->created_at->toIso8601String(),
        ]);

        $message = ['embeds' => [$embed]];

        if ($buttons = self::buttons($notification, $payload['buttons'] ?? [])) {
            $message['components'] = [['type' => 1, 'components' => $buttons]];
        }

        // Only the people and roles named here are pinged; never @everyone or @here
        $users = $payload['mentions']['users'] ?? [];
        $roles = $payload['mentions']['roles'] ?? [];
        $pings = [
            ...array_map(fn (string $id) => "<@&{$id}>", $roles),
            ...array_map(fn (string $id) => "<@{$id}>", $users),
        ];
        if ($pings) {
            $message['content'] = implode(' ', $pings);
        }
        $message['allowed_mentions'] = ['parse' => [], 'users' => array_values($users), 'roles' => array_values($roles)];

        return $message;
    }

    /**
     * Link buttons (at most 5). Without any, one "Buka di VidHelp" to the notification's link.
     * Discord refuses link buttons to addresses like localhost, so they need a public frontend.
     */
    private static function buttons(AppNotification $notification, array $buttons): array
    {
        if ($buttons === [] && $notification->link) {
            $buttons = [['label' => 'Buka di VidHelp', 'path' => $notification->link]];
        }

        return self::linkButtons($buttons);
    }

    /**
     * Buttons that open these VidHelp pages (at most 5); none when the frontend isn't public.
     *
     * @param  list<array{label: string, path: string}>  $buttons
     */
    public static function linkButtons(array $buttons): array
    {
        if (! self::isPublic(config('app.frontend_url'))) {
            return [];
        }

        return collect($buttons)->take(5)->map(fn (array $button) => [
            'type' => 2,
            'style' => 5,
            'label' => Str::limit($button['label'], 75),
            'url' => self::url($button['path']),
        ])->all();
    }

    private static function url(?string $path): ?string
    {
        return $path ? rtrim(config('app.frontend_url'), '/').$path : null;
    }

    /** A web address Discord can open (not localhost or a local-only name). */
    private static function isPublic(?string $url): bool
    {
        $host = $url && preg_match('#^https?://#', $url) ? parse_url($url, PHP_URL_HOST) : null;
        if (! $host) {
            return false;
        }
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return (bool) filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
        }

        return str_contains($host, '.') && ! preg_match('/\.(local|localhost|test|internal)$/', $host);
    }
}
