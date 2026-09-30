---
paths:
  - 'app/Http/**'
---

# Http

## Validate inline in controllers
Validate with `$request->validate([...])` inside the controller action and use the returned array. This project has no Form Request classes; do not add them.

## Authorize with role middleware, not Policies
Authorize by role with Spatie `role:` middleware on route groups, and check record ownership in the controller with `abort_unless(...)`. There are no Policies or Gates; do not add them.
