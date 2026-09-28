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

];
