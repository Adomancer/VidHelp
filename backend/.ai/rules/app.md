---
paths:
  - 'app/**'
---

# App

## Business rules live in config/vidhelp.php
Put tunable business rules in config/vidhelp.php (env-backed with defaults) and read them with `config('vidhelp.…')`. Do not hardcode thresholds or durations.

## Send notifications through Notifier
Send notifications through `App\Services\Notifier` (`toUsers()` / `toChannel()`), which writes the in-app bell and Discord. Do not use Laravel Notification classes or events for app notifications.

## Dates: helpers for now, CarbonImmutable for math
Use `now()` / `today()` for the current moment. Build date and time windows with `CarbonImmutable::parse()` and type-hint `CarbonImmutable`, not mutable `Carbon`.
