<?php

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
    ['opened' => $opened, 'filled' => $filled] = $backups->autoProcess();
    $this->info("Opened {$opened} unreviewed request(s), auto-picked a cover for {$filled}.");
})->purpose('Open backup requests nobody reviewed and pick covers for ones about to start');

Schedule::command('backups:auto-process')->everyMinute();

Artisan::command('points:apply-penalties', function (PointService $points) {
    $penalized = $points->penalizeLateSickLetters();
    $this->info("Deducted points for {$penalized} late or missing sick letter(s).");
})->purpose('Deduct points for sick letters that were missing or late');

Schedule::command('points:apply-penalties')->everyTenMinutes();

Artisan::command('payroll:roll-periods', function (PayrollService $payroll) {
    $closed = $payroll->rollPeriods();
    $this->info("{$closed} ended period(s) now wait for payment.");
})->purpose('Move ended payment periods to waiting_payment and open current periods');

Schedule::command('payroll:roll-periods')->dailyAt('00:05');

Artisan::command('notifications:retry-discord', function (Notifier $notifier) {
    $retried = $notifier->retry();
    $this->info("Retried {$retried} Discord message(s).");
})->purpose('Resend Discord messages that failed or were never sent');

Schedule::command('notifications:retry-discord')->everyFiveMinutes();
