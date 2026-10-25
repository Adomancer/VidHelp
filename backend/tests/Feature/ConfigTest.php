<?php

namespace Tests\Feature;

use App\Providers\AppServiceProvider;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class ConfigTest extends TestCase
{
    use RefreshDatabase;

    public function test_jobs_that_change_data_never_run_twice_at_once(): void
    {
        $events = collect(app(Schedule::class)->events());

        foreach (['backups:auto-process', 'points:apply-penalties', 'payroll:roll-periods', 'notifications:retry-discord', 'notifications:send-reminders'] as $command) {
            $event = $events->first(fn (Event $event) => str_contains((string) $event->command, $command));

            $this->assertNotNull($event, "{$command} is scheduled");
            $this->assertTrue($event->withoutOverlapping, "{$command} waits out a run still going");
            $this->assertTrue($event->onOneServer, "{$command} runs on one server");
        }
    }

    public function test_debug_mode_is_switched_off_in_production(): void
    {
        Log::spy();
        $this->app['env'] = 'production';
        config(['app.debug' => true]);

        (new AppServiceProvider($this->app))->boot();

        $this->assertFalse(config('app.debug'));
        Log::shouldHaveReceived('critical')->once();
    }

    public function test_debug_mode_stays_as_set_outside_production(): void
    {
        Log::spy();
        config(['app.debug' => true]);

        (new AppServiceProvider($this->app))->boot();

        $this->assertTrue(config('app.debug'));
        Log::shouldNotHaveReceived('critical');
    }
}
