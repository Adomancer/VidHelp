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

        // TODO: late check-in rule, not decided by the agency yet
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
        // Admins must set up an authenticator app before they can use the app
        // (false = optional: admins may turn it on or off themselves)
        'required_for_admins' => (bool) env('TWO_FACTOR_REQUIRED_FOR_ADMINS', true),

        // Name shown next to the account in the authenticator app
        'issuer' => env('TWO_FACTOR_ISSUER', env('APP_NAME', 'VidHelp')),

        // The code step of a sign-in expires after this many minutes / wrong codes
        'challenge_minutes' => 5,
        'challenge_attempts' => 5,

        'recovery_codes' => 8,
    ],

    'audit' => [
        // Audit rows older than this are deleted daily (0 = keep forever)
        'keep_days' => (int) env('AUDIT_KEEP_DAYS', 365),
    ],

];
