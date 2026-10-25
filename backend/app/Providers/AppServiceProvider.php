<?php

namespace App\Providers;

use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\User;
use App\Services\SettingsService;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;

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
        // Every api/* error is rendered as JSON, so debug mode would hand stack traces and SQL to
        // any client: never in production, whatever APP_DEBUG says
        if ($this->app->isProduction() && config('app.debug')) {
            config(['app.debug' => false]);
            Log::critical('APP_DEBUG is true in production; it was turned off for this request. Set APP_DEBUG=false in .env.');
        }

        // Admin-edited business rules (Settings page) override config/vidhelp.php
        $this->app->make(SettingsService::class)->apply();

        // Short owner_type names in the attachments table (not enforced, so Spatie/Sanctum keep class names)
        Relation::morphMap([
            'backup_request' => BackupRequest::class,
            'brand' => Brand::class,
        ]);

        // Password reset emails link to the Next.js frontend, not a Laravel page
        ResetPassword::createUrlUsing(fn (User $user, string $token) => config('app.frontend_url').$user->passwordResetPath($token));

        // Public sign-ups per IP (each one creates an account and alerts the admins)
        RateLimiter::for('register', fn (Request $request) => Limit::perHour(config('vidhelp.signup.per_ip_per_hour'))
            ->by($request->ip())
            ->response(fn () => response()->json(['message' => 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.'], 429)));

        // Sign-ins end after vidhelp.sessions (max length and idle time, by role). Runs before
        // Sanctum stamps last_used_at, so that still holds the previous request's time.
        Sanctum::authenticateAccessTokensUsing(
            fn (PersonalAccessToken $token, bool $isValid) => $isValid && $token->tokenable instanceof User && $token->tokenable->tokenStillValid($token)
        );
    }
}
