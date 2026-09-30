---
paths:
  - 'app/Http/Controllers/**'
---

# Controllers

## Controllers are grouped by role
Controllers live in role folders (Admin/, Operator/, Host/, Auth/) that match the `admin`, `operator` and `host` route groups in routes/api.php. Put a new endpoint in the folder and route group of the role that uses it.

## Business logic lives in app/Services
Put business logic in plain classes in app/Services and inject them with constructor promotion (`public function __construct(private XService $x)`). Controllers only validate, run simple Eloquent CRUD, and shape the response. No Action classes, repositories, or jobs.

## Respond with keyed JSON, no API Resources
Return `response()->json([...])` with named keys, e.g. `['brand' => $brand, 'message' => 'Brand created']`. No API Resource classes and no Blade views: the backend is a JSON API for the Next.js frontend.
