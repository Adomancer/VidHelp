<?php

use App\Models\AuditLog;
use App\Models\HostProfile;
use App\Services\BackupService;
use App\Services\Notifier;
use App\Services\PayrollService;
use App\Services\PointService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('hosts:sync-rate-categories', function () {
    $changed = HostProfile::syncAllRateCategories();
    $this->info("{$changed} host(s) moved to a new rate level.");
})->purpose('Move hosts up a rate level based on tenure (skips manual overrides)');

Schedule::command('hosts:sync-rate-categories')->dailyAt('00:10');

Artisan::command('backups:auto-process', function (BackupService $backups) {
    $filled = $backups->autoProcess();
    $this->info("Auto-picked a cover for {$filled} request(s).");
})->purpose('Pick the best applicant for backup requests about to start that nobody decided on');

Schedule::command('backups:auto-process')->everyMinute();

Artisan::command('points:apply-penalties', function (PointService $points) {
    $penalized = $points->penalizeLateSickLetters();
    $this->info("Deducted points for {$penalized} late or missing sick letter(s).");
})->purpose('Deduct points for sick letters that were missing or late');

Schedule::command('points:apply-penalties')->everyTenMinutes();

Artisan::command('payroll:roll-periods', function (PayrollService $payroll) {
    $closed = $payroll->rollPeriods();
    $this->info("{$closed} period(s) reached their target and wait for payment.");
})->purpose('Open each brand\'s running pay period and close it if its target is reached');

Schedule::command('payroll:roll-periods')->dailyAt('00:05');

Artisan::command('notifications:retry-discord', function (Notifier $notifier) {
    $retried = $notifier->retry();
    $this->info("Retried {$retried} Discord message(s).");
})->purpose('Resend Discord messages that failed or were never sent');

Schedule::command('notifications:retry-discord')->everyFiveMinutes();

// Delete audit rows older than vidhelp.audit.keep_days
Schedule::command('model:prune', ['--model' => [AuditLog::class]])->dailyAt('01:00');
