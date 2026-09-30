---
paths:
  - 'app/Services/**'
---

# Services

## Business logic lives in app/Services
Put business logic in plain classes in app/Services and inject them with constructor promotion (`public function __construct(private XService $x)`). Controllers only validate, run simple Eloquent CRUD, and shape the response. No Action classes, repositories, or jobs.

## Services throw ValidationException for rule violations
When a business rule fails, throw `ValidationException::withMessages(['field' => ['Message']])` so the frontend shows it under that field.
