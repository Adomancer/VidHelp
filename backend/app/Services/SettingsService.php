<?php

namespace App\Services;

use App\Models\BackupQuota;
use App\Models\SystemSetting;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Admin-editable business rules. Defaults come from config/vidhelp.php; an admin's
 * saved value (system_settings row) is layered on top at boot, so the rest of the
 * app keeps reading config('vidhelp.…').
 */
class SettingsService
{
    private const CACHE_KEY = 'system-settings';

    public const GROUPS = [
        'backups' => 'Backup',
        'attendance' => 'Absensi dan laporan live',
        'points' => 'Poin dan surat peringatan',
        'security' => 'Keamanan',
    ];

    /**
     * Key = path under config('vidhelp'). type: int | bool; options limit an int to a fixed list.
     */
    public const DEFINITIONS = [
        'backup.quota_per_month' => [
            'group' => 'backups', 'type' => 'int', 'min' => 0, 'max' => 31, 'unit' => 'kali',
            'label' => 'Kuota backup lintas brand per host per bulan',
            'help' => 'Menggantikan di brand sendiri tidak pernah dihitung. Perubahan juga berlaku untuk bulan ini.',
        ],
        'backup.request_min_hours_before' => [
            'group' => 'backups', 'type' => 'int', 'min' => 0, 'max' => 336, 'unit' => 'jam',
            'label' => 'Host mengajukan backup paling lambat',
            'help' => 'Sebelum sesi dimulai. Kalau lebih mepet, hanya admin atau operator yang bisa membuka permintaan (darurat).',
        ],
        'backup.direct_max_hosts' => [
            'group' => 'backups', 'type' => 'int', 'min' => 2, 'max' => 20, 'unit' => 'host',
            'label' => 'Maksimal host yang bisa diminta langsung',
            'help' => 'Host yang meminta orang tertentu untuk menggantikan harus memilih minimal 2 dan maksimal sebanyak ini.',
        ],
        'backup.auto_fill_before_minutes' => [
            'group' => 'backups', 'type' => 'int', 'min' => 0, 'max' => 1440, 'unit' => 'menit',
            'label' => 'Setujui pengganti otomatis sebelum sesi',
            'help' => 'Kalau admin belum memutuskan, pendaftar terbaik otomatis disetujui selama ini sebelum sesi dimulai.',
        ],
        'backup.sick_letter_grace_hours' => [
            'group' => 'backups', 'type' => 'int', 'min' => 1, 'max' => 168, 'unit' => 'jam',
            'label' => 'Batas surat sakit setelah sesi dimulai',
            'help' => 'Surat yang tidak ada atau terlambat akan memotong poin.',
        ],
        'attendance.check_in_opens_minutes' => [
            'group' => 'attendance', 'type' => 'int', 'min' => 0, 'max' => 720, 'unit' => 'menit',
            'label' => 'Check-in dibuka sebelum sesi',
            'help' => 'Seberapa awal tombol check-in bisa dipakai.',
        ],
        'attendance.report_due_hours' => [
            'group' => 'attendance', 'type' => 'int', 'min' => 1, 'max' => 168, 'unit' => 'jam',
            'label' => 'Batas laporan live setelah check-in',
            'help' => 'Laporan yang belum dikirim sampai batas ini ditandai terlambat.',
        ],
        'attendance.duration_tolerance_minutes' => [
            'group' => 'attendance', 'type' => 'int', 'min' => 0, 'max' => 240, 'unit' => 'menit',
            'label' => 'Toleransi persetujuan otomatis',
            'help' => 'Laporan yang lebih singkat dari jadwal paling banyak sebesar ini disetujui otomatis; selebihnya menunggu dicek.',
        ],
        'points.starting_points' => [
            'group' => 'points', 'type' => 'int', 'min' => 1, 'max' => 1000, 'unit' => 'poin',
            'label' => 'Poin awal',
            'help' => 'Setiap host memulai periode poin dengan jumlah ini. Saldo yang sudah berjalan tetap memakai angkanya.',
        ],
        'points.reset_every_months' => [
            'group' => 'points', 'type' => 'int', 'options' => [1, 2, 3, 4, 6, 12], 'unit' => 'bulan',
            'label' => 'Poin direset setiap',
            'help' => 'Periode mengikuti kalender (3 = Jan, Apr, Jul, Okt). Mengubahnya langsung memulai periode baru, jadi ubah saat pergantian periode.',
        ],
        'points.sp_thresholds.1' => [
            'group' => 'points', 'type' => 'int', 'min' => 0, 'max' => 1000, 'unit' => 'poin',
            'label' => 'SP1 di angka atau di bawah',
            'help' => 'Harus lebih kecil dari poin awal.',
        ],
        'points.sp_thresholds.2' => [
            'group' => 'points', 'type' => 'int', 'min' => 0, 'max' => 1000, 'unit' => 'poin',
            'label' => 'SP2 di angka atau di bawah',
            'help' => 'Harus lebih kecil dari SP1.',
        ],
        'points.sp_thresholds.3' => [
            'group' => 'points', 'type' => 'int', 'min' => 0, 'max' => 1000, 'unit' => 'poin',
            'label' => 'SP3 di angka atau di bawah',
            'help' => 'Harus lebih kecil dari SP2.',
        ],
        'two_factor.required_for_admins' => [
            'group' => 'security', 'type' => 'bool',
            'label' => 'Wajibkan verifikasi dua langkah untuk admin dan finance',
            'help' => 'Kalau aktif, admin atau finance yang belum memakai 2FA harus mengaturnya dulu sebelum memakai aplikasi, dan tidak bisa mematikannya.',
        ],
        'audit.keep_days' => [
            'group' => 'security', 'type' => 'int', 'min' => 0, 'max' => 3650, 'unit' => 'hari',
            'label' => 'Simpan catatan log audit selama',
            'help' => 'Catatan yang lebih lama dihapus setiap malam. 0 berarti simpan semuanya.',
        ],
    ];

    /** Settings any signed-in user may read (the numbers shown in help texts). */
    public const PUBLIC_KEYS = [
        'backup.request_min_hours_before',
        'backup.direct_min_hosts',
        'backup.direct_max_hosts',
        'backup.auto_fill_before_minutes',
        'backup.sick_letter_grace_hours',
        'backup.quota_per_month',
    ];

    /** @var array<string, mixed> config values before any admin override */
    private array $defaults = [];

    /**
     * Put the admins' saved values into config. Runs once per request / command at boot.
     */
    public function apply(): void
    {
        foreach (array_keys(self::DEFINITIONS) as $key) {
            $this->defaults[$key] ??= config("vidhelp.{$key}");
        }

        foreach ($this->overrides() as $key => $value) {
            if (isset(self::DEFINITIONS[$key])) {
                config(["vidhelp.{$key}" => $value]);
            }
        }
    }

    public function default(string $key): mixed
    {
        return $this->defaults[$key] ?? config("vidhelp.{$key}");
    }

    /**
     * Every setting with its current value, default and who last changed it, grouped for the settings page.
     */
    public function all(): array
    {
        $rows = SystemSetting::with('updater:id,name')->get()->keyBy('key');

        return collect(self::GROUPS)->map(fn (string $label, string $group) => [
            'key' => $group,
            'label' => $label,
            'settings' => collect(self::DEFINITIONS)
                ->filter(fn (array $definition) => $definition['group'] === $group)
                ->map(fn (array $definition, string $key) => [
                    'key' => $key,
                    ...array_diff_key($definition, ['group' => true]),
                    'value' => config("vidhelp.{$key}"),
                    'default' => $this->default($key),
                    'changed_at' => $rows->get($key)?->updated_at?->toIso8601String(),
                    'changed_by' => $rows->get($key)?->updater?->name,
                ])
                ->values()
                ->all(),
        ])->values()->all();
    }

    /** @return array<string, mixed> */
    public function publicValues(): array
    {
        return collect(self::PUBLIC_KEYS)->mapWithKeys(fn (string $key) => [$key => config("vidhelp.{$key}")])->all();
    }

    /**
     * Save changed values. A value equal to the default removes the override.
     *
     * @param  array<string, mixed>  $values  key => new value
     * @return list<string> keys that changed
     */
    public function update(array $values, User $by): array
    {
        $values = $this->validate($values);
        $changed = array_keys(array_filter($values, fn ($value, $key) => $value !== config("vidhelp.{$key}"), ARRAY_FILTER_USE_BOTH));

        DB::transaction(function () use ($changed, $values, $by) {
            foreach ($changed as $key) {
                $row = SystemSetting::firstOrNew(['key' => $key]);

                if ($values[$key] === $this->default($key)) {
                    if ($row->exists) {
                        $row->delete();
                    }
                } else {
                    $row->fill(['value' => $values[$key], 'updated_by' => $by->id])->save();
                }
                config(["vidhelp.{$key}" => $values[$key]]);
            }

            // Quotas are stored per month; this month's rows follow the new number
            if (in_array('backup.quota_per_month', $changed, true)) {
                BackupQuota::where('month_year', now()->format('Y-m'))->update(['quota_max' => $values['backup.quota_per_month']]);
            }
        });

        Cache::forget(self::CACHE_KEY);

        return $changed;
    }

    /**
     * Check each value against its definition and the SP thresholds against each other.
     *
     * @return array<string, int|bool> the values cast to their type
     */
    private function validate(array $values): array
    {
        $errors = [];
        $clean = [];

        foreach ($values as $key => $value) {
            $definition = self::DEFINITIONS[$key] ?? null;
            if (! $definition) {
                $errors[$key] = ['Pengaturan ini tidak ada.'];

                continue;
            }

            $rules = $definition['type'] === 'bool'
                ? ['required', 'boolean']
                : ['required', 'integer', ...(isset($definition['options'])
                    ? ['in:'.implode(',', $definition['options'])]
                    : ["min:{$definition['min']}", "max:{$definition['max']}"])];

            $validator = Validator::make(['value' => $value], ['value' => $rules], [], ['value' => strtolower($definition['label'])]);
            if ($validator->fails()) {
                $errors[$key] = $validator->errors()->get('value');

                continue;
            }

            $clean[$key] = $definition['type'] === 'bool' ? (bool) $value : (int) $value;
        }

        if ($errors === []) {
            $errors = $this->checkThresholds($clean);
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $clean;
    }

    /** SP1 > SP2 > SP3, all below the starting points (using saved values for the ones not being changed). */
    private function checkThresholds(array $values): array
    {
        $value = fn (string $key) => $values[$key] ?? config("vidhelp.{$key}");
        $start = $value('points.starting_points');
        [$sp1, $sp2, $sp3] = [$value('points.sp_thresholds.1'), $value('points.sp_thresholds.2'), $value('points.sp_thresholds.3')];

        return array_filter([
            'points.sp_thresholds.1' => $sp1 >= $start ? ["SP1 harus lebih kecil dari poin awal ({$start})."] : null,
            'points.sp_thresholds.2' => $sp2 >= $sp1 ? ["SP2 harus lebih kecil dari SP1 ({$sp1})."] : null,
            'points.sp_thresholds.3' => $sp3 >= $sp2 ? ["SP3 harus lebih kecil dari SP2 ({$sp2})."] : null,
        ]);
    }

    /** @return array<string, mixed> saved overrides; empty before the table exists (fresh install, migrations) */
    private function overrides(): array
    {
        try {
            return Cache::rememberForever(self::CACHE_KEY, fn () => SystemSetting::pluck('value', 'key')->all());
        } catch (Throwable) {
            return [];
        }
    }
}
