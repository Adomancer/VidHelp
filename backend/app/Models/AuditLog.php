<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

/**
 * One line in the audit trail. Written by the Auditable trait (create/update/delete)
 * and by AuditLog::record() for events like logins, approvals and 2FA changes.
 */
#[Fillable([
    'user_id', 'action', 'target_table', 'target_id', 'target_label',
    'old_value', 'new_value', 'ip_address', 'user_agent', 'created_at',
])]
class AuditLog extends Model
{
    use HasUuids, MassPrunable;

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'old_value' => 'array',
            'new_value' => 'array',
            'created_at' => 'datetime',
        ];
    }

    /** Who did it (null = the system, e.g. a scheduled job, or a failed login). */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class)->withTrashed();
    }

    /**
     * Write a row. The actor defaults to the signed-in user; IP and browser come from the request.
     */
    public static function record(
        string $action,
        ?Model $target = null,
        ?array $old = null,
        ?array $new = null,
        ?User $actor = null,
        ?string $label = null,
    ): self {
        $request = app()->runningInConsole() && ! app()->runningUnitTests() ? null : request();

        return self::create([
            'user_id' => ($actor ?? Auth::user())?->getKey(),
            'action' => $action,
            'target_table' => $target?->getTable(),
            'target_id' => $target?->getKey(),
            'target_label' => $label ?? ($target ? self::labelFor($target) : null),
            'old_value' => $old ?: null,
            'new_value' => $new ?: null,
            'ip_address' => $request?->ip(),
            'user_agent' => $request ? Str::limit((string) $request->userAgent(), 250, '') ?: null : null,
            'created_at' => now(),
        ]);
    }

    /** A readable name for the record, when it has one. */
    private static function labelFor(Model $target): ?string
    {
        $attributes = $target->getAttributes();
        $label = $attributes['name'] ?? $attributes['title'] ?? $attributes['email'] ?? $attributes['key'] ?? null;

        return is_string($label) ? Str::limit($label, 250, '') : null;
    }

    /** Old rows are deleted by `php artisan model:prune` (scheduled daily). 0 keeps everything. */
    public function prunable(): Builder
    {
        $days = (int) config('vidhelp.audit.keep_days');

        return $days > 0
            ? static::where('created_at', '<', now()->subDays($days))
            : static::whereRaw('1 = 0');
    }
}
