<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Appends;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * A host can't make one occurrence of their slot and needs someone to cover it.
 *
 * pending → (admin approves, or auto after auto_open_at) → open → (admin picks,
 * or best applicant auto-picked at auto_fill_at) → filled. Also: rejected, cancelled.
 */
#[Fillable([
    'slot_id', 'brand_id', 'requesting_host_id', 'created_by', 'backup_date', 'start_at', 'end_at',
    'reason_type', 'reason', 'status', 'approved_by', 'approved_at', 'auto_approved', 'auto_open_at',
    'auto_fill_at', 'auto_filled', 'counts_toward_quota', 'letter_penalty_applied', 'filled_by_host_id', 'filled_at', 'cancelled_at',
])]
#[Appends(['letter_status', 'letter_due_at'])]
class BackupRequest extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'backup_date' => 'date:Y-m-d',
            'start_at' => 'datetime',
            'end_at' => 'datetime',
            'approved_at' => 'datetime',
            'auto_open_at' => 'datetime',
            'auto_fill_at' => 'datetime',
            'filled_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'auto_approved' => 'boolean',
            'auto_filled' => 'boolean',
            'counts_toward_quota' => 'boolean',
            'letter_penalty_applied' => 'boolean',
        ];
    }

    public function slot(): BelongsTo
    {
        return $this->belongsTo(ScheduleSlot::class, 'slot_id');
    }

    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'requesting_host_id');
    }

    public function filler(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'filled_by_host_id');
    }

    public function applications(): HasMany
    {
        return $this->hasMany(BackupApplication::class);
    }

    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'owner')->latest();
    }

    /** Month whose quota a cross-brand cover uses, e.g. "2026-09". */
    public function quotaMonth(): string
    {
        return $this->backup_date->format('Y-m');
    }

    /**
     * What other hosts may see (no absence reason). Needs brand and requester.user loaded.
     */
    public function publicSummary(): array
    {
        return [
            'id' => $this->id,
            'slot_id' => $this->slot_id,
            'brand' => $this->brand->only('id', 'name'),
            'requester_name' => $this->requester->user->name,
            'backup_date' => $this->backup_date->toDateString(),
            'start_at' => $this->start_at,
            'end_at' => $this->end_at,
            'status' => $this->status,
        ];
    }

    /**
     * How the backup marks the requester's slot on a schedule. Needs filler.user loaded.
     */
    public function slotMarker(): array
    {
        return [
            'id' => $this->id,
            'slot_id' => $this->slot_id,
            'backup_date' => $this->backup_date->toDateString(),
            'status' => $this->status,
            'filler_name' => $this->filler?->user->name,
        ];
    }

    public function isOpenForApplications(): bool
    {
        return $this->status === 'open' && $this->end_at->isFuture();
    }

    /** Sick requests need a doctor's letter by start + grace hours. */
    protected function letterDueAt(): Attribute
    {
        return Attribute::get(fn () => $this->reason_type === 'sick'
            ? $this->start_at->copy()->addHours(config('vidhelp.backup.sick_letter_grace_hours'))
            : null);
    }

    /** not_needed | uploaded | due | late */
    protected function letterStatus(): Attribute
    {
        return Attribute::get(function () {
            if ($this->reason_type !== 'sick' || in_array($this->status, ['cancelled', 'rejected'])) {
                return 'not_needed';
            }

            $uploaded = $this->relationLoaded('attachments') ? $this->attachments->isNotEmpty() : $this->attachments()->exists();

            return match (true) {
                $uploaded => 'uploaded',
                $this->letter_due_at->isPast() => 'late',
                default => 'due',
            };
        });
    }
}
