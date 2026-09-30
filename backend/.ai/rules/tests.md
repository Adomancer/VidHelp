---
paths:
  - 'tests/**'
---

# Tests

## Feature test style
Write PHPUnit feature classes with `test_snake_case` methods, `RefreshDatabase`, and `$this->seed(RoleSeeder::class)` in setUp. Only User has a factory; create other records with `Model::create([...])` in private helpers. The base TestCase blocks real HTTP, so fake it with `Http::fake()`.
