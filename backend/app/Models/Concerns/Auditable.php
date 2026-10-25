<?php

namespace App\Models\Concerns;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;

/**
 * Writes an audit row whenever the model is created, updated or deleted through Eloquent.
 * Hidden and encrypted fields (passwords, KTP, bank numbers) are recorded as changed
 * without their values. Bulk query updates (Model::where()->update()) are not seen.
 */
trait Auditable
{
    public static function bootAuditable(): void
    {
        static::created(function (Model $model) {
            AuditLog::record('create', $model, new: $model->auditValues(array_keys($model->getAttributes())));
        });

        static::updated(function (Model $model) {
            $changed = array_keys($model->getChanges());
            $new = $model->auditValues($changed);
            if ($new === []) {
                return;
            }

            AuditLog::record('update', $model, old: $model->auditValues($changed, original: true), new: $new);
        });

        static::deleted(function (Model $model) {
            AuditLog::record('delete', $model, old: $model->auditValues(array_keys($model->getAttributes())));
        });
    }

    /** Extra columns this model doesn't want in the log (on top of the timestamps). */
    public function auditExcept(): array
    {
        return [];
    }

    /**
     * @param  list<string>  $keys
     * @return array<string, mixed>
     */
    public function auditValues(array $keys, bool $original = false): array
    {
        $skip = [...$this->auditExcept(), $this->getCreatedAtColumn(), $this->getUpdatedAtColumn(), 'remember_token'];
        $values = [];

        foreach (array_diff($keys, $skip) as $key) {
            if (in_array($key, $this->getHidden(), true) || $this->hasCast($key, ['encrypted', 'encrypted:array', 'encrypted:json'])) {
                $values[$key] = '[hidden]';

                continue;
            }

            $value = $original ? $this->getRawOriginal($key) : $this->getAttributes()[$key] ?? null;
            if (is_string($value) && $this->hasCast($key, ['array', 'json', 'object', 'collection'])) {
                $value = json_decode($value, true);
            }
            $values[$key] = $value;
        }

        return $values;
    }
}
