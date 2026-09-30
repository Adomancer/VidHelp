# VidHelp

Management app for a live-streaming host agency: hosts go live for brands on a weekly schedule, cover each other with backups, check in and send live reports, and get paid per approved hour. Admins and operators run it all from desktop pages; hosts use a mobile-first app.

- **Backend:** Laravel 13 JSON API in [`backend/`](backend/)
- **Frontend:** Next.js 16 (App Router, React 19, TypeScript, Tailwind CSS 4) in [`frontend/`](frontend/)
- **Progress report and full setup guide:** [VidHelp Progress Report](https://claude.ai/code/artifact/becd92d0-070a-4415-b54d-893fa1cfc4d0) (tab "Setup Project" covers PHP, SSL, MySQL, Google and Discord step by step)

**Contents:** [Quick start](#quick-start) · [How the backend works](#how-the-backend-works) · [API reference](#api-reference) · [Building UI](#building-ui) · [What's left](#whats-left)

---

## Quick start

Needs PHP 8.3+, Composer, MySQL (e.g. XAMPP), Node 20+. Details and fixes for common problems are in the Setup Project tab linked above.

```bash
# Backend (terminal 1)
cd backend
composer install
cp .env.example .env          # then set DB_* and FRONTEND_URL=http://localhost:3000
php artisan key:generate
php artisan migrate --seed    # tables, roles, rate levels, violation types, admin account
php artisan storage:link
php artisan serve             # http://localhost:8000

# Scheduled jobs (terminal 2) — backups, penalties, pay periods, Discord retries
cd backend && php artisan schedule:work

# Frontend (terminal 3)
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

Sign in as **admin@vidhelp.com / password**. Admins must set up two-factor sign-in (an authenticator app) on first login.

Tests run against a separate MySQL database named `vidhelp_test`:

```bash
cd backend
DB_CONNECTION=mysql DB_DATABASE=vidhelp_test php artisan test
```

---

## Roles

| Role | Uses | Layout |
| --- | --- | --- |
| **Admin** | Everything, plus users, KTP/bank data, payroll, settings, audit log | Desktop sidebar (purple) |
| **Operator** | Schedules, backups, live reports, events, points | Desktop sidebar |
| **Host** | Own schedule, check-in and live report, backups, score, pay, profile | Mobile bottom nav |

New sign-ups (email or Google) are **pending hosts** until an admin approves them on Users.

---

## How the backend works

### A request, step by step

```
routes/api.php            which URL, which role group
  → middleware            auth:sanctum → active → two_factor → role:admin|operator|host
  → Controller            validates input inline ($request->validate), calls a service
  → Service               business logic (app/Services)
  → Models                Eloquent, UUID keys
  → response()->json([...])
```

- **Controllers** are thin and grouped by role: `Admin/`, `Operator/`, `Host/`, `Auth/` match the route groups.
- **Services** hold the rules (who can cover a backup, how pay is calculated, when an SP is issued). Controllers get them by constructor injection.
- **Business numbers** (quota, deadlines, SP thresholds, …) live in [`config/vidhelp.php`](backend/config/vidhelp.php). Admins can override most of them on the Settings page. Code always reads them with `config('vidhelp.…')`, so both work.
- **Notifications** always go through `Notifier`, which writes the in-app bell and, if configured, Discord.
- **Audit:** models with the `Auditable` trait log every create/update/delete; sign-ins, approvals and 2FA events use `AuditLog::record()`.

House coding rules that every contributor (and AI agent) follows are in [`backend/.ai/rules/`](backend/.ai/rules/). Read [`index.md`](backend/.ai/rules/index.md) before changing backend code.

### Where things are

| Path | What's there |
| --- | --- |
| `app/Http/Controllers/Admin/` | Users, hosts (KTP/bank), brands, rate levels, points corrections, ratings, payroll, kasbon, settings, audit log, dashboard |
| `app/Http/Controllers/Operator/` | Hosts and assignments, schedules, backups, live reports, events, points, dashboard |
| `app/Http/Controllers/Host/` | Profile, my schedule, availability, backups, live check-in/report, events, score, pay |
| `app/Http/Controllers/Auth/` | Login, register, Google sign-in, password reset, 2FA code step |
| `app/Http/Controllers/*.php` | Shared for every role: notifications, Discord link, my 2FA, public settings |
| `app/Http/Middleware/` | `EnsureUserIsActive` (`active`), `EnsureTwoFactorSetUp` (`two_factor`) |
| `app/Models/` | 35 models; `Concerns/Auditable.php` is the audit trait |
| `config/vidhelp.php` | Business rule defaults |
| `routes/api.php` | Every API route, grouped by role |
| `routes/console.php` | Scheduled jobs |
| `tests/Feature/` | One test file per module (176 tests) |

### Services

| Service | Responsible for |
| --- | --- |
| `AttendanceService` | A host's sessions, check-in/out, live reports, auto-approval, turning approved reports into paid work sessions |
| `BackupService` | Backup requests (open to all or to named hosts), who may cover, admin approves or rejects applicants, auto-approval before the slot, quota, sick letters |
| `EventService` / `EventCalendar` | Special events (PD, double date): blocks hosts claim, which regular slots they replace |
| `HostCalendar` | When a host or brand is busy (slots, covers, events), used to prevent clashes |
| `PointService` | Points per 3-month period, violations, penalties, automatic SP1–SP3 |
| `RatingService` | Monthly 1–5 host ratings and the suggested value |
| `PayrollService` | Pay periods per brand, host pay, payment requests, salary slips, kasbon, CSV export |
| `Notifier` / `DiscordClient` | Bell notifications, Discord channel posts and DMs, retries |
| `TwoFactorService` / `Totp` | Admin two-factor sign-in, recovery codes |
| `SettingsService` | Admin-editable rules layered over `config/vidhelp.php` |
| `DashboardService` | Dashboard figures: what needs attention, today's sessions, brand progress, hours per day |

### Scheduled jobs

| Command | When | Does |
| --- | --- | --- |
| `backups:auto-process` | every minute | approves the best applicant for requests about to start that nobody decided on |
| `points:apply-penalties` | every 10 min | deducts points for late or missing sick letters |
| `notifications:retry-discord` | every 5 min | resends failed Discord messages |
| `payroll:roll-periods` | 00:05 | closes ended pay periods, opens new ones |
| `hosts:sync-rate-categories` | 00:10 | moves hosts up a rate level by tenure |
| `model:prune` (audit log) | 01:00 | deletes audit rows older than the retention setting |

The database design is in [`08_Skema_Database_ERD_v2.mmd`](08_Skema_Database_ERD_v2.mmd) (Mermaid), kept in sync with the migrations.

---

## API reference

Base URL `http://localhost:8000/api`. Send `Accept: application/json` and, once signed in, `Authorization: Bearer <token>`.

| Prefix | Who | Main endpoints |
| --- | --- | --- |
| `/auth` | Public, 10 req/min | `POST register`, `POST login`, `POST two-factor-challenge`, `GET google/redirect`, `GET google/callback`, `POST forgot-password`, `POST reset-password` |
| `/auth/me`, `/auth/logout` | Signed in | current user (with `roles`), sign out |
| `/two-factor` | Admin | status, `setup`, `confirm`, `recovery-codes`, turn off |
| `/notifications`, `/discord`, `/settings` | Any active user | bell list and unread count, Discord link, public rule numbers |
| `/admin/...` | Admin | `dashboard`, `users`, `hosts/{id}`, `brands`, `rate-categories`, `points/...`, `warning-letters`, `violation-types`, `ratings`, `payroll/...`, `cash-advances`, `settings`, `audit-logs` |
| `/operator/...` | Operator, admin | `dashboard`, `hosts`, `brands`, `assignments`, `schedules`, `backups/...`, `reports/...`, `events/...`, `points/...` |
| `/host/...` | Any active user | `profile`, `schedules`, `availability`, `backups/...`, `live/...`, `events/...`, `performance`, `pay` |

Run `php artisan route:list --path=api` for every route with its controller method.

### Responses you need to handle

| Case | Status | Body |
| --- | --- | --- |
| Success | 200 / 201 | named keys, e.g. `{ "brand": {...}, "message": "Brand created" }` |
| Validation or business rule failed | 422 | `{ "message": "...", "errors": { "field": ["Message"] } }` — show each under its field |
| Wrong role | 403 | `{ "message": "..." }` |
| Account no longer active | 403 | `{ "message": "...", "status": "inactive" }` — sign the user out |
| Admin must set up 2FA first | 403 | `{ "code": "two_factor_setup_required" }` — send them to `/two-factor/setup` |
| Token missing or revoked | 401 | sign the user out |
| Login needs a 2FA code | 200 | `{ "two_factor": true, "challenge_token": "..." }` instead of a token |

Times are sent as ISO 8601 in Asia/Jakarta (WIB). Durations are hours as decimals (`0.25` = 15 minutes); always **show them as hours and minutes** with `formatDuration()`.

---

## Building UI

### Frontend map

| Path | What's there |
| --- | --- |
| `src/app/(auth)/` | Login, register, password reset, Google callback, 2FA setup (centered card layout) |
| `src/app/(admin)/admin/` | Admin pages; `layout.tsx` holds the sidebar links |
| `src/app/(operator)/operator/` | Operator pages; own sidebar |
| `src/app/(host)/host/` | Host pages; mobile bottom nav in `layout.tsx` |
| `src/components/` | Shared pieces: `Card`, `FormAlert`, `TextField`, `SelectField`, `SubmitButton`, badges, and the big "desk" components that several pages share (`BackupDesk`, `PayrollDesk`, `PointsDesk`, `ReportReview`, `ScheduleBoard`, `EventManager`) |
| `src/lib/api.ts` | **Every API call and its TypeScript types**, grouped (`authApi`, `hostApi`, `scheduleApi`, `payrollApi`, `dashboardApi`, …) |
| `src/lib/useApiData.ts` | Load data for a page: `{ data, error, loading, reload, setData }` |
| `src/lib/useApiForm.ts` | Submit a form: puts 422 errors under each field, other errors in `error` |
| `src/lib/format.ts` | `formatDuration`, `formatRupiah`, `formatDate`, `formatWindow`, `formatClock`, … |
| `src/lib/auth.ts` | Token storage, `homePathFor(user)` |
| `src/components/AuthProvider.tsx` | `<RequireAuth roles>` guard used by each layout, and `useAuth()` for `{ user, token }` |

This is **Next.js 16**, which differs from older versions. Check `frontend/node_modules/next/dist/docs/` before using a Next.js API you're not sure about (see [`frontend/AGENTS.md`](frontend/AGENTS.md)).

### Adding a page, step by step

1. **Find or add the API call** in `src/lib/api.ts`. If the endpoint is new, add its response type next to it.
2. **Create the page** in the right route group, e.g. `src/app/(operator)/operator/dashboard/page.tsx`. The layout already checks the role.
3. **Load data** with `useApiData`, and **show errors** with `FormAlert`:

   ```tsx
   "use client";

   import { dashboardApi } from "@/lib/api";
   import { useApiData } from "@/lib/useApiData";
   import { useAuth } from "@/components/AuthProvider";
   import Card from "@/components/Card";
   import FormAlert from "@/components/FormAlert";

   export default function ExamplePage() {
     const { token } = useAuth();
     const dashboard = useApiData("admin-dashboard", () => dashboardApi.admin(token));

     return (
       <div className="space-y-6">
         <h1 className="text-2xl font-bold text-white">Example</h1>
         {dashboard.error && <FormAlert tone="error">{dashboard.error}</FormAlert>}
         {dashboard.data && <Card title="Today">{dashboard.data.today.sessions.length} sessions</Card>}
       </div>
     );
   }
   ```

4. **Forms** use `useApiForm(submit, onSuccess)` with `TextField` (pass `error={errors.field}`) and `SubmitButton`. Look at `components/PasswordForm.tsx` for a small complete example.
5. **Add it to the sidebar** in that role's `layout.tsx` (`links` array), or to the bottom nav for host pages.
6. **Check** before committing: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

### UI rules

- **Look:** dark slate background (`bg-slate-950`, cards `bg-slate-900 border-slate-800`), white headings, `text-gray-400` for secondary text, purple for actions and accents. Reuse `Card`, `FormAlert`, `TextField`, `SubmitButton` instead of new styles.
- **Host pages are mobile-first:** design for a phone width first, then desktop.
- **Never hardcode a business number** in text (like "30 minutes" or "24 hours"). Read it from `settingsApi.public()`; see `components/BackupTimingNote.tsx`.
- **Durations** always as hours and minutes (`formatDuration`), money as rupiah (`formatRupiah`).
- **Status badges** have a word, not only a color (see `BackupBadges.tsx`).
- **Lint rule:** don't call `setState` directly inside `useEffect`. Render a form only after its data loads (see the Settings page), or use `useApiData`.
- **Hidden values stay hidden:** KTP and bank numbers come masked except on admin endpoints; don't try to unmask them in the UI.

### Page status

| Area | Status |
| --- | --- |
| Auth, 2FA, all host pages, all admin pages, operator schedules/events/backups/reports/hosts/points | Done and connected to the API |
| **Operator dashboard** (`/operator/dashboard`) | **Placeholder cards showing "—"**, not connected yet. `GET /api/operator/dashboard` returns simple counts; the admin dashboard (`/admin/dashboard`) is the model to follow |

---

## What's left

**UI**
- Operator dashboard page (see Page status).

**Backend**
1. Operators can't add a check-in a host forgot, or record a no-show with a penalty (the admin dashboard already shows missed sessions).
2. Editing a weekly slot also changes past weeks; edits should start a new slot from a date.
3. Real email sending: password reset emails only go to `storage/logs/laravel.log` for now.
4. Production setup: server, cron for the scheduler, HTTPS, production `.env`.
5. Smaller: partial-session backups, stored PDF salary slips, a price per hour per brand (invoice in rupiah), a penalty for releasing an event block late.

**Waiting on the agency's decision**
- Late check-in rule (after how many minutes, how many points).
- Live report template (real fields instead of GMV, orders, viewers).
- Payroll carry-over for host pay.
