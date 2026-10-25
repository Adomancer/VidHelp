<?php

use App\Models\AuditLog;
use App\Models\HostProfile;
use App\Models\User;
use App\Services\BackupService;
use App\Services\DiscordClient;
use App\Services\DiscordCommands;
use App\Services\DiscordPreview;
use App\Services\Notifier;
use App\Services\PayrollService;
use App\Services\PointService;
use App\Services\ReminderService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Sleep;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

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

// The jobs below change data: a run waits out one still going (withoutOverlapping, the lock
// expiring after the minutes given if a run dies), and with several servers only one runs it
// (onOneServer: needs a shared cache store with locks, e.g. CACHE_STORE=database or redis)
Schedule::command('backups:auto-process')->everyMinute()->withoutOverlapping(10)->onOneServer();

Artisan::command('points:apply-penalties', function (PointService $points) {
    $penalized = $points->penalizeLateSickLetters();
    $this->info("Deducted points for {$penalized} late or missing sick letter(s).");
})->purpose('Deduct points for sick letters that were missing or late');

Schedule::command('points:apply-penalties')->everyTenMinutes()->withoutOverlapping(30)->onOneServer();

Artisan::command('payroll:roll-periods', function (PayrollService $payroll) {
    $closed = $payroll->rollPeriods();
    $this->info("{$closed} period(s) reached their target and wait for payment.");
})->purpose('Open each brand\'s running pay period and close it if its target is reached');

Schedule::command('payroll:roll-periods')->dailyAt('00:05')->withoutOverlapping(60)->onOneServer();

Artisan::command('notifications:retry-discord', function (Notifier $notifier) {
    $retried = $notifier->retry();
    $this->info("Retried {$retried} Discord message(s).");
})->purpose('Resend Discord messages that failed or were never sent');

Schedule::command('notifications:retry-discord')->everyFiveMinutes()->withoutOverlapping(30)->onOneServer();

Artisan::command('notifications:send-reminders', function (ReminderService $reminders) {
    $sent = $reminders->send();
    $this->info("Sent {$sent} reminder(s).");
})->purpose('Remind hosts of sessions, live reports and sick letters, and staff of backup decisions, before they are due');

Schedule::command('notifications:send-reminders')->everyFiveMinutes()->withoutOverlapping(30)->onOneServer();

Artisan::command('discord:preview {to=backups : backups, admin, or the email of a user who linked Discord} {--only=* : Only these types, e.g. --only=backup_opened}', function (DiscordPreview $preview) {
    $to = $this->argument('to');
    $target = in_array($to, ['backups', 'admin'], true) ? $to : User::where('email', $to)->with('discordLink')->first();
    if (! $target) {
        $this->error("Tidak ada pengguna dengan email {$to}.");

        return 1;
    }

    try {
        $channelId = $preview->channelFor($target);
    } catch (ValidationException $e) {
        $this->error(collect($e->errors())->flatten()->first());

        return 1;
    }

    $types = $this->option('only') ?: $preview->types();
    foreach ($types as $i => $type) {
        try {
            $preview->send($channelId, $type);
            $this->line("<info>✓</info> {$type}");
        } catch (Throwable $e) {
            $this->line("<error>✗</error> {$type}: {$e->getMessage()}");
        }

        // Discord allows about 5 messages per 5 seconds in a channel
        if ($i < count($types) - 1) {
            Sleep::for(1100)->milliseconds();
        }
    }

    return 0;
})->purpose('Send an example of every notification type to a Discord channel or DM, to see how they look');

Artisan::command('discord:register-commands', function (DiscordClient $discord, DiscordCommands $commands) {
    if (! $discord->hasGuild() || ! filled(config('services.discord.client_id'))) {
        $this->error('Isi DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID dan DISCORD_GUILD_ID dulu.');

        return 1;
    }

    foreach ($discord->registerCommands($commands->definitions()) as $command) {
        $this->line("<info>✓</info> /{$command['name']}");
    }

    if (! filled(config('services.discord.public_key'))) {
        $this->warn('DISCORD_PUBLIC_KEY is empty: the commands show up, but VidHelp refuses them until it is set.');
    }

    return 0;
})->purpose('Register the bot\'s slash commands in the agency server (run again after changing them)');

// Delete audit rows older than vidhelp.audit.keep_days
Schedule::command('model:prune', ['--model' => [AuditLog::class]])->dailyAt('01:00');

// Delete sign-ins that can't be used anymore (vidhelp.sessions): past their expires_at, or unused for
// longer than any role's idle limit (this also clears tokens issued before they got an expiry)
Schedule::command('sanctum:prune-expired', ['--hours' => 0])->dailyAt('01:10');
Schedule::call(function () {
    $cutoff = now()->subHours(collect(config('vidhelp.sessions'))->max('idle_hours'));

    PersonalAccessToken::where(fn ($q) => $q
        ->where('last_used_at', '<', $cutoff)
        ->orWhere(fn ($q) => $q->whereNull('last_used_at')->where('created_at', '<', $cutoff)))
        ->delete();
})->name('sessions:prune-idle')->dailyAt('01:10');
