<?php

namespace App\Services;

use App\Models\User;
use Carbon\CarbonInterface;

/**
 * What one notification says. The bell shows title and body; Discord also shows the
 * brand, the fields, the person's photo and link buttons, and pings the mentioned users.
 *
 *     Notice::make('backup_picked', 'Kamu menggantikan di Brand A')
 *         ->body('Sel 6 Okt 14:00–16:00, untuk Nina.')
 *         ->brand('Brand A')
 *         ->field('Waktu', Notice::window($start, $end))
 *         ->link('/host/schedule', 'Lihat jadwal');
 */
final class Notice
{
    public ?string $body = null;

    public ?string $link = null;

    /** @var list<array{name: string, value: string, inline: bool}> */
    public array $fields = [];

    /** @var list<array{label: string, path: string}> */
    public array $buttons = [];

    /** @var list<User> */
    public array $mentions = [];

    public ?string $brand = null;

    public ?string $thumbnail = null;

    public ?string $category = null;

    /** Sent once per user: a second notice with the same key is dropped (reminders). */
    public ?string $key = null;

    public function __construct(public string $type, public string $title) {}

    public static function make(string $type, string $title): self
    {
        return new self($type, $title);
    }

    public function body(?string $body): self
    {
        $this->body = $body;

        return $this;
    }

    /** Where the bell and the embed title open; with a label, also the first button. */
    public function link(string $path, ?string $label = null): self
    {
        $this->link = $path;

        return $label ? $this->button($label, $path) : $this;
    }

    public function button(string $label, string $path): self
    {
        $this->buttons[] = ['label' => $label, 'path' => $path];

        return $this;
    }

    /** A Discord field; empty values are left out. */
    public function field(string $name, string|int|float|null $value, bool $inline = true): self
    {
        if ($value !== null && $value !== '') {
            $this->fields[] = ['name' => $name, 'value' => (string) $value, 'inline' => $inline];
        }

        return $this;
    }

    public function brand(?string $name): self
    {
        $this->brand = $name;

        return $this;
    }

    /** The person the notice is about: their photo shows next to the Discord message. */
    public function about(?User $user): self
    {
        $this->thumbnail = $user?->avatar_url;

        return $this;
    }

    /**
     * Users pinged when the notice is posted to a channel (those who linked Discord).
     *
     * @param  User|iterable<User|null>|null  $users
     */
    public function mention(User|iterable|null $users): self
    {
        foreach ($users instanceof User ? [$users] : ($users ?? []) as $user) {
            if ($user) {
                $this->mentions[] = $user;
            }
        }

        return $this;
    }

    /** Overrides the type's category (e.g. a host notice copied to staff). */
    public function category(string $category): self
    {
        $this->category = $category;

        return $this;
    }

    public function key(string $key): self
    {
        $this->key = $key;

        return $this;
    }

    /** A copy with another type and title (the same details for another audience). */
    public function as(string $type, string $title): self
    {
        $copy = clone $this;
        $copy->type = $type;
        $copy->title = $title;

        return $copy;
    }

    public function resolvedCategory(): string
    {
        return $this->category ?? NotificationTypes::category($this->type);
    }

    /** Stored with each delivery, so a retried Discord message looks the same. */
    public function payload(): array
    {
        return array_filter([
            'category' => $this->resolvedCategory(),
            'brand' => $this->brand,
            'thumbnail' => $this->thumbnail,
            'fields' => $this->fields,
            'buttons' => $this->buttons,
        ], fn ($value) => $value !== null && $value !== []);
    }

    /** "Selasa, 6 Oktober 2026 14:00 (dalam 2 hari)" in each reader's own time zone. */
    public static function time(CarbonInterface $at): string
    {
        return "<t:{$at->getTimestamp()}:F> (<t:{$at->getTimestamp()}:R>)";
    }

    /** "Selasa, 6 Oktober 2026 14:00 – 16:00 (dalam 2 hari)". */
    public static function window(CarbonInterface $start, CarbonInterface $end): string
    {
        return "<t:{$start->getTimestamp()}:F> – <t:{$end->getTimestamp()}:t> (<t:{$start->getTimestamp()}:R>)";
    }
}
