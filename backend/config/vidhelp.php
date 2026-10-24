<?php

/*
|--------------------------------------------------------------------------
| VidHelp business rules
|--------------------------------------------------------------------------
| Defaults for rules the agency may tune. The ones listed in
| App\Services\SettingsService::DEFINITIONS can be changed by an admin on the
| Settings page; those saved values (system_settings table) override these.
*/

return [

    'backup' => [
        // Cross-brand covers a host may do per month (same-brand covers are free)
        'quota_per_month' => (int) env('BACKUP_QUOTA_PER_MONTH', 3),

        // Hosts must request a backup at least this many hours before the slot starts
        // (closer to the slot, only an admin/operator can open one: emergencies)
        'request_min_hours_before' => (int) env('BACKUP_REQUEST_MIN_HOURS_BEFORE', 24),

        // A request to specific hosts must name at least / at most this many
        'direct_min_hosts' => 2,
        'direct_max_hosts' => (int) env('BACKUP_DIRECT_MAX_HOSTS', 5),

        // This many minutes before the slot, the best applicant is picked if the admin didn't decide yet
        'auto_fill_before_minutes' => (int) env('BACKUP_AUTO_FILL_BEFORE_MINUTES', 30),

        // Sick letter is due this many hours after the slot starts
        'sick_letter_grace_hours' => (int) env('BACKUP_SICK_LETTER_GRACE_HOURS', 24),
    ],

    'attendance' => [
        // Check-in opens this many minutes before a session (sanity window, not a late rule)
        'check_in_opens_minutes' => (int) env('ATTENDANCE_CHECK_IN_OPENS_MINUTES', 60),

        // The live report is due this many hours after check-in
        'report_due_hours' => (int) env('ATTENDANCE_REPORT_DUE_HOURS', 24),

        // Reported hours may be this much under the scheduled length and still auto-approve
        'duration_tolerance_minutes' => (int) env('ATTENDANCE_DURATION_TOLERANCE_MINUTES', 15),

        // Checking in more than this many minutes after the start counts as late (the "Telat" violation)
        'late_after_minutes' => (int) env('ATTENDANCE_LATE_AFTER_MINUTES', 10),
    ],

    // Reminders sent by `notifications:send-reminders` (in-app and Discord DM). 0 turns one off.
    'notifications' => [
        // Hosts hear this many minutes before a session they haven't checked in for
        // (and again when it has started without a check-in)
        'live_reminder_minutes' => (int) env('NOTIFY_LIVE_REMINDER_MINUTES', 30),

        // Hosts hear this many hours before a live report or sick letter is due
        'deadline_reminder_hours' => (int) env('NOTIFY_DEADLINE_REMINDER_HOURS', 3),

        // Staff hear this many minutes before the best backup applicant is picked automatically
        'decision_reminder_minutes' => (int) env('NOTIFY_DECISION_REMINDER_MINUTES', 60),
    ],

    // Numbers the host types into the live report. Placeholder until the agency's
    // report template arrives: add/rename keys here (and in the frontend field list).
    'report_metrics' => [
        'gmv' => 'nullable|numeric|min:0',
        'orders' => 'nullable|integer|min:0',
        'viewers' => 'nullable|integer|min:0',
    ],

    'points' => [
        // Every host starts each points period with this many points
        'starting_points' => (int) env('POINTS_STARTING', 100),

        // Points reset every N months, aligned to the calendar (3 = Jan, Apr, Jul, Oct)
        'reset_every_months' => (int) env('POINTS_RESET_EVERY_MONTHS', 3),

        // An SP is issued automatically when points fall to or below these values (placeholders)
        'sp_thresholds' => [1 => 75, 2 => 50, 3 => 25],
    ],

    'rating' => [
        'min' => 1,
        'max' => 5,
    ],

    'two_factor' => [
        // Admins and finance must set up an authenticator app before they can use the app
        // (false = optional: they may turn it on or off themselves)
        'required_for_admins' => (bool) env('TWO_FACTOR_REQUIRED_FOR_ADMINS', true),

        // Name shown next to the account in the authenticator app
        'issuer' => env('TWO_FACTOR_ISSUER', env('APP_NAME', 'VidHelp')),

        // The code step of a sign-in expires after this many minutes / wrong codes
        'challenge_minutes' => 5,
        'challenge_attempts' => 5,

        'recovery_codes' => 8,

        // Wrong codes one account may enter across sign-ins before the code step is blocked for a while
        'user_attempts' => 10,
        'user_decay_minutes' => 15,
    ],

    // Wrong passwords before signing in to that email is blocked for a while: from one IP, and in total
    // (many IPs guessing one account). A correct password resets both.
    'login' => [
        'max_attempts' => 5,
        'decay_minutes' => 1,
        'account_max_attempts' => 20,
        'account_decay_minutes' => 15,
    ],

    // The first admin, created by RoleSeeder. Production refuses to create it without a password here.
    'seed_admin' => [
        'email' => env('ADMIN_SEED_EMAIL', 'admin@vidhelp.com'),
        'password' => env('ADMIN_SEED_PASSWORD'),
    ],

    // How long a sign-in lasts: at most `max_hours` after logging in, and it ends early after
    // `idle_hours` without any request. A user with several roles gets the strictest.
    'sessions' => [
        // Admin and finance see KTP, bank accounts and payroll
        'admin' => [
            'max_hours' => (int) env('SESSION_ADMIN_MAX_HOURS', 24),
            'idle_hours' => (int) env('SESSION_ADMIN_IDLE_HOURS', 12),
        ],
        'operator' => [
            'max_hours' => (int) env('SESSION_OPERATOR_MAX_HOURS', 24 * 7),
            'idle_hours' => (int) env('SESSION_OPERATOR_IDLE_HOURS', 24),
        ],
        // Hosts sign in on their phone; logging in often would get in the way of checking in
        'host' => [
            'max_hours' => (int) env('SESSION_HOST_MAX_HOURS', 24 * 30),
            'idle_hours' => (int) env('SESSION_HOST_IDLE_HOURS', 24 * 14),
        ],
    ],

    'audit' => [
        // Audit rows older than this are deleted daily (0 = keep forever)
        'keep_days' => (int) env('AUDIT_KEEP_DAYS', 365),
    ],

];
