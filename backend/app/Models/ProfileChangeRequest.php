<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A host's new or changed personal data waiting for an admin's decision. The values are
 * encrypted (they include KTP and bank numbers); the profile only changes on approval.
 */
#[Fillable(['host_id', 'new_values', 'status', 'reviewed_by', 'reviewed_at', 'review_note'])]
#[Hidden(['new_values'])]
class ProfileChangeRequest extends Model
{
    use Auditable, HasUuids;

    /** Fields a host can ask to change, with their labels. */
    public const FIELDS = [
        'name' => 'Nama lengkap',
        'phone' => 'No. HP',
        'guardian_phone' => 'No. HP wali',
        'ktp_number' => 'Nomor KTP (NIK)',
        'bank_name' => 'Bank',
        'bank_account' => 'Nomor rekening',
        'account_holder_name' => 'Nama pemilik rekening',
    ];

    /** Shown to the host only masked, like the saved values. */
    public const SECRET = ['ktp_number', 'bank_account'];

    protected function casts(): array
    {
        return [
            'new_values' => 'encrypted:array',
            'reviewed_at' => 'datetime',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(HostProfile::class, 'host_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    /**
     * What the host asked for, as label/value lines; KTP and bank numbers masked unless `$full`.
     *
     * @return list<array{field: string, label: string, value: ?string}>
     */
    public function lines(bool $full = false): array
    {
        $lines = [];
        foreach (self::FIELDS as $field => $label) {
            if (array_key_exists($field, $this->new_values ?? [])) {
                $value = $this->new_values[$field];
                $lines[] = [
                    'field' => $field,
                    'label' => $label,
                    'value' => ! $full && in_array($field, self::SECRET, true) && $value !== null
                        ? str_repeat('*', max(0, strlen($value) - 4)).substr($value, -4)
                        : $value,
                ];
            }
        }

        return $lines;
    }
}
