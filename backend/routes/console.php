<?php

use App\Models\HostProfile;
use App\Services\BackupService;
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
