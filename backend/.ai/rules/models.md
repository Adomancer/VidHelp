---
paths:
  - 'app/Models/**'
---

# Models

## Model metadata via PHP attributes
Declare model metadata with PHP attributes (`#[Fillable]`, `#[Hidden]`, `#[Appends]`, `#[Table]`) and local scopes with `#[Scope]`, not `$fillable`/`$hidden` properties or `scopeXxx()` methods.

## UUID primary keys everywhere
Every table uses UUID keys: `HasUuids` on the model, `$table->uuid('id')->primary()` and `foreignUuid(...)->constrained()` in migrations.

## Statuses are enum columns, not PHP enums
Store statuses as database `enum()` columns and handle them as plain strings validated with `in:` rules. Do not add PHP enum classes.

## Audit important models
Add the `Auditable` trait to models whose changes matter. Record non-CRUD events (logins, approvals, 2FA) with `AuditLog::record(...)`.
