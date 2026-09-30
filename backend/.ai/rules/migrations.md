---
paths:
  - 'database/migrations/**'
---

# Migrations

## UUID primary keys everywhere
Every table uses UUID keys: `HasUuids` on the model, `$table->uuid('id')->primary()` and `foreignUuid(...)->constrained()` in migrations.

## Statuses are enum columns, not PHP enums
Store statuses as database `enum()` columns and handle them as plain strings validated with `in:` rules. Do not add PHP enum classes.

## Migration column types and grouping
Use `dateTime()` rather than `timestamp()` for app date-time columns. When creating a new module's tables, put all of them in one date-prefixed migration (e.g. `create_attendance_tables`). Changes to existing tables always go in a new migration; never edit an existing one.
