<?php

/*
|--------------------------------------------------------------------------
| VidHelp business rules
|--------------------------------------------------------------------------
| Defaults for rules the agency may tune. These move to the SYSTEM_SETTINGS
| table (editable by admin) later.
*/

return [

    'backup' => [
        // Cross-brand covers a host may do per month (same-brand covers are free)
        'quota_per_month' => (int) env('BACKUP_QUOTA_PER_MONTH', 3),

        // A request nobody approved/rejected opens by itself after this many minutes
        'auto_open_after_minutes' => (int) env('BACKUP_AUTO_OPEN_AFTER_MINUTES', 30),

        // This many minutes before the slot, the best applicant is picked if nobody chose yet
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

];
