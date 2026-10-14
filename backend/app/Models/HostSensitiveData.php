<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Appends;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * KTP and bank details. Encrypted at rest; serialized masked unless the
 * caller explicitly makeVisible()s the raw fields (admin only).
 */
#[Table('host_sensitive_data')]
#[Fillable(['host_id', 'ktp_number', 'bank_name', 'bank_account', 'account_holder_name'])]
#[Hidden(['ktp_number', 'bank_account', 'ktp_image_path'])]
#[Appends(['ktp_number_masked', 'bank_account_masked'])]
class HostSensitiveData extends Model
{
    use Auditable, HasUuids;

    protected function casts(): array
    {
        return [
            'ktp_number' => 'encrypted',
            'bank_account' => 'encrypted',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    protected function ktpNumberMasked(): Attribute
    {
        return Attribute::get(fn () => self::mask($this->ktp_number));
    }

    protected function bankAccountMasked(): Attribute
    {
        return Attribute::get(fn () => self::mask($this->bank_account));
    }

    /** "3201234567890001" → "************0001" */
    private static function mask(?string $value): ?string
    {
        return $value === null ? null : str_repeat('*', max(0, strlen($value) - 4)).substr($value, -4);
    }
}
