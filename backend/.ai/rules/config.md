---
paths:
  - 'config/**'
---

# Config

## Business rules live in config/vidhelp.php
Put tunable business rules in config/vidhelp.php (env-backed with defaults) and read them with `config('vidhelp.…')`. Do not hardcode thresholds or durations.
