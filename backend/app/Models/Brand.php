<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Services\RichText;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * A client brand. Its pay periods start on `payroll_start_date`, and each one runs until
 * `target_hours_per_period` hours are reached; the brand's leader host then requests payment.
 */
#[Fillable(['name', 'is_obs', 'product_knowledge', 'target_hours_per_period', 'payroll_start_date', 'status'])]
class Brand extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'is_obs' => 'boolean',
            'target_hours_per_period' => 'integer',
            'payroll_start_date' => 'date:Y-m-d',
        ];
    }

    /** Formatted text (safe HTML); plain text, e.g. pasted from WA, is converted on the way in. */
    protected function productKnowledge(): Attribute
    {
        return Attribute::set(fn (?string $value) => RichText::normalize($value));
    }

    public function paymentPeriods(): HasMany
    {
        return $this->hasMany(PaymentPeriod::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(HostBrandAssignment::class);
    }

    /** Product knowledge files the brand sent (PDF, screenshots, Office docs), next to the text. */
    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'owner')->latest();
    }
}
