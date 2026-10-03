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
        'backups' => 'Backups',
        'attendance' => 'Attendance and live reports',
        'points' => 'Points and warning letters',
        'security' => 'Security',
    ];

    /**
     * Key = path under config('vidhelp'). type: int | bool; options limit an int to a fixed list.
     */
    public const DEFINITIONS = [
        'backup.quota_per_month' => [
            'group' => 'backups', 'type' => 'int', 'min' => 0, 'max' => 31, 'unit' => 'covers',
            'label' => 'Cross-brand covers per host per month',
            'help' => 'Covering a shift of your own brand never counts. A change also applies to this month.',
        ],
        'backup.request_min_hours_before' => [
            'group' => 'backups', 'type' => 'int', 'min' => 0, 'max' => 336, 'unit' => 'hours',
            'label' => 'Hosts request a backup at least',
            'help' => 'Before the session starts. Closer to the session, only an admin or operator can open a request (emergencies).',
        ],
        'backup.direct_max_hosts' => [
            'group' => 'backups', 'type' => 'int', 'min' => 2, 'max' => 20, 'unit' => 'hosts',
            'label' => 'Most hosts a named request can ask',
            'help' => 'A host who asks specific people to cover must name at least 2 and at most this many.',
        ],
        'backup.auto_fill_before_minutes' => [
            'group' => 'backups', 'type' => 'int', 'min' => 0, 'max' => 1440, 'unit' => 'minutes',
            'label' => 'Auto-approve a cover before the session',
            'help' => 'If the admin has not decided yet, the best applicant is approved automatically this long before the session starts.',
        ],
        'backup.sick_letter_grace_hours' => [
            'group' => 'backups', 'type' => 'int', 'min' => 1, 'max' => 168, 'unit' => 'hours',
            'label' => 'Sick letter due after the session starts',
            'help' => 'A missing or late letter costs points.',
        ],
        'attendance.check_in_opens_minutes' => [
            'group' => 'attendance', 'type' => 'int', 'min' => 0, 'max' => 720, 'unit' => 'minutes',
            'label' => 'Check-in opens before the session',
            'help' => 'How early the check-in button works.',
        ],
        'attendance.report_due_hours' => [
            'group' => 'attendance', 'type' => 'int', 'min' => 1, 'max' => 168, 'unit' => 'hours',
            'label' => 'Live report due after check-in',
            'help' => 'Reports not sent by then show as overdue.',
        ],
        'attendance.duration_tolerance_minutes' => [
            'group' => 'attendance', 'type' => 'int', 'min' => 0, 'max' => 240, 'unit' => 'minutes',
            'label' => 'Auto-approve tolerance',
            'help' => 'A report up to this much shorter than the scheduled session is approved automatically; otherwise it waits for review.',
        ],
        'points.starting_points' => [
            'group' => 'points', 'type' => 'int', 'min' => 1, 'max' => 1000, 'unit' => 'points',
            'label' => 'Starting points',
            'help' => 'Every host starts each points period with this many. Balances already started keep their number.',
        ],
        'points.reset_every_months' => [
            'group' => 'points', 'type' => 'int', 'options' => [1, 2, 3, 4, 6, 12], 'unit' => 'months',
            'label' => 'Points reset every',
            'help' => 'Periods line up with the calendar (3 = Jan, Apr, Jul, Oct). Changing it starts a new period right away, so change it at a period boundary.',
        ],
        'points.sp_thresholds.1' => [
            'group' => 'points', 'type' => 'int', 'min' => 0, 'max' => 1000, 'unit' => 'points',
            'label' => 'SP1 at or below',
            'help' => 'Must be below the starting points.',
        ],
        'points.sp_thresholds.2' => [
            'group' => 'points', 'type' => 'int', 'min' => 0, 'max' => 1000, 'unit' => 'points',
            'label' => 'SP2 at or below',
            'help' => 'Must be below SP1.',
        ],
        'points.sp_thresholds.3' => [
            'group' => 'points', 'type' => 'int', 'min' => 0, 'max' => 1000, 'unit' => 'points',
            'label' => 'SP3 at or below',
            'help' => 'Must be below SP2.',
        ],
        'two_factor.required_for_admins' => [
            'group' => 'security', 'type' => 'bool',
            'label' => 'Require two-factor sign-in for admins and finance',
            'help' => 'When on, an admin or finance user without 2FA must set it up before using the app, and cannot turn it off.',
        ],
        'audit.keep_days' => [
            'group' => 'security', 'type' => 'int', 'min' => 0, 'max' => 3650, 'unit' => 'days',
            'label' => 'Keep audit log entries for',
            'help' => 'Older entries are deleted every night. 0 keeps everything.',
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
                $errors[$key] = ['This setting does not exist.'];

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
            'points.sp_thresholds.1' => $sp1 >= $start ? ["SP1 must be below the starting points ({$start})."] : null,
            'points.sp_thresholds.2' => $sp2 >= $sp1 ? ["SP2 must be below SP1 ({$sp1})."] : null,
            'points.sp_thresholds.3' => $sp3 >= $sp2 ? ["SP3 must be below SP2 ({$sp2})."] : null,
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
