<?php

namespace App\Services;

/**
 * Every notification type with its category (what a user can mute for Discord DMs),
 * the emoji and color its Discord message gets, and whether it is critical (always sent).
 */
final class NotificationTypes
{
    public const GREEN = 0x22C55E;

    public const YELLOW = 0xF59E0B;

    public const RED = 0xEF4444;

    public const BLUE = 0x3B82F6;

    public const PURPLE = 0x9333EA;

    public const GRAY = 0x64748B;

    /** Category => label, and the roles it is offered to in the preferences. */
    public const CATEGORIES = [
        'backup' => ['label' => 'Backup', 'roles' => ['host']],
        'schedule' => ['label' => 'Jadwal, event dan pengingat live', 'roles' => ['host']],
        'report' => ['label' => 'Laporan live', 'roles' => ['host']],
        'payroll' => ['label' => 'Gaji dan pembayaran', 'roles' => ['host', 'admin', 'finance']],
        'points' => ['label' => 'Poin dan SP', 'roles' => ['host']],
        'admin' => ['label' => 'Peringatan staff (backup, laporan, pendaftar, SP)', 'roles' => ['admin', 'finance', 'operator']],
        'account' => ['label' => 'Akun', 'roles' => []],
    ];

    /** Categories muted when staff link Discord: those alerts also go to #admin-alerts. */
    public const STAFF_MUTED_BY_DEFAULT = ['admin'];

    /** type => [category, emoji, color, critical] */
    private const TYPES = [
        'signup_pending' => ['admin', '👤', self::PURPLE],
        'account_approved' => ['account', '🎉', self::GREEN, true],
        'profile_change_requested' => ['admin', '📝', self::PURPLE],
        'profile_change_approved' => ['account', '✅', self::GREEN],
        'profile_change_rejected' => ['account', '❌', self::RED],

        'report_flagged' => ['admin', '🚩', self::YELLOW],
        'report_rejected' => ['report', '❌', self::RED],

        'backup_opened' => ['backup', '🆘', self::BLUE],
        'backup_asked' => ['backup', '🙏', self::BLUE],
        'backup_applied' => ['admin', '🙋', self::PURPLE],
        'backup_picked' => ['backup', '✅', self::GREEN],
        'backup_covered' => ['backup', '🤝', self::GREEN],
        'backup_filled' => ['backup', '✅', self::GREEN],
        'backup_not_picked' => ['backup', '➖', self::GRAY],
        'backup_reopened' => ['backup', '🔁', self::YELLOW],
        'backup_unassigned' => ['backup', '↩️', self::YELLOW],
        'backup_cancelled' => ['backup', '🚫', self::GRAY],
        'backup_auto_picked' => ['admin', '🤖', self::PURPLE],
        'backup_no_cover' => ['admin', '⚠️', self::RED],
        'backup_decision_due' => ['admin', '⏳', self::YELLOW],

        'event_opened' => ['schedule', '🎪', self::BLUE],

        'period_ready' => ['payroll', '🎯', self::GREEN],
        'payment_requested' => ['payroll', '💸', self::PURPLE],
        'slip_ready' => ['payroll', '💰', self::GREEN, true],

        'points_deducted' => ['points', '📉', self::RED],
        'sp_issued' => ['points', '🛑', self::RED, true],

        'reminder_live_soon' => ['schedule', '⏰', self::YELLOW],
        'reminder_check_in' => ['schedule', '⏰', self::RED],
        'reminder_report_due' => ['report', '📝', self::YELLOW],
        'reminder_sick_letter' => ['backup', '📄', self::YELLOW],
    ];

    public static function category(string $type): string
    {
        return self::TYPES[$type][0] ?? 'account';
    }

    /** @return list<string> every known type */
    public static function types(): array
    {
        return array_keys(self::TYPES);
    }

    public static function categoryLabel(string $category): string
    {
        return self::CATEGORIES[$category]['label'] ?? 'Notifikasi';
    }

    public static function emoji(string $type): string
    {
        return self::TYPES[$type][1] ?? '🔔';
    }

    public static function color(string $type): int
    {
        return self::TYPES[$type][2] ?? self::PURPLE;
    }

    /** Critical types reach Discord even when their category is muted. */
    public static function critical(string $type): bool
    {
        return self::TYPES[$type][3] ?? false;
    }

    /**
     * The categories a user with these roles can mute.
     *
     * @param  iterable<string>  $roles
     * @return list<string>
     */
    public static function categoriesFor(iterable $roles): array
    {
        $roles = collect($roles);

        return collect(self::CATEGORIES)
            ->filter(fn (array $category) => $roles->intersect($category['roles'])->isNotEmpty())
            ->keys()
            ->all();
    }
}
