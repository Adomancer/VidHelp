<?php

namespace App\Providers;

use App\Models\BackupRequest;
use App\Models\User;
use App\Services\SettingsService;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // One instance per request so it remembers the config defaults it overrode
        $this->app->singleton(SettingsService::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Admin-edited business rules (Settings page) override config/vidhelp.php
        $this->app->make(SettingsService::class)->apply();

        // Short owner_type names in the attachments table (not enforced, so Spatie/Sanctum keep class names)
        Relation::morphMap([
            'backup_request' => BackupRequest::class,
        ]);

        // Password reset emails link to the Next.js frontend, not a Laravel page
        ResetPassword::createUrlUsing(fn (User $user, string $token) => config('app.frontend_url')
            .'/reset-password?'.http_build_query(['token' => $token, 'email' => $user->getEmailForPasswordReset()]));
    }
}
