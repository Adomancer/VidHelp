# VidHelp frontend

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 with shadcn/Radix, TanStack Query and nuqs. It talks to the Laravel API in [`../backend`](../backend); see the [root README](../README.md) for the whole setup.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

The backend must be running too (`php artisan serve`, port 8000). Its `FRONTEND_URL` has to be this app's URL (Google/Discord redirects and links in notifications point here).

| Variable              | Default                     | What                                                                                     |
| --------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api` | The Laravel API. Also allowed in the Content-Security-Policy (`connect-src`, `img-src`). |

Put it in `.env.local` (git-ignored). It is the only variable; nothing secret belongs in `NEXT_PUBLIC_*`.

Development accounts come from the backend seeders: `php artisan migrate --seed` creates `admin@vidhelp.com`, and `php artisan db:seed --class=DemoSeeder2` adds hosts (`bulk01@vidhelp.com` …), `operator1@vidhelp.com` and `finance@vidhelp.com`, all with password `password`. Admin and finance accounts must set up 2FA unless the backend runs with `TWO_FACTOR_REQUIRED_FOR_ADMINS=false`.

## Scripts

| Script                            | Does                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js                                                                                      |
| `npm run lint`                    | ESLint (Next core-web-vitals + TypeScript)                                                   |
| `npm run typecheck`               | Generates Next's route types, then `tsc --noEmit`                                            |
| `npm run format` / `format:check` | Prettier (160 columns, Tailwind class order). Files keep LF line endings (`.gitattributes`). |
| `npm test`                        | Vitest unit tests (`src/**/*.test.ts(x)`, jsdom, run with `TZ=America/New_York`)             |
| `npm run test:e2e`                | Playwright smoke test against a running app (below)                                          |

CI (`.github/workflows/frontend.yml`) runs lint, typecheck, format:check, tests and a build on every push touching `frontend/`.

### End-to-end smoke test

Signs in through the login form as each role and checks the dashboard. Needs the frontend and a seeded backend running:

```bash
E2E_BASE_URL=http://localhost:3000 E2E_CHANNEL=msedge npm run test:e2e
```

`E2E_CHANNEL` uses a browser installed on the machine (`msedge`, `chrome`); without it run `npx playwright install chromium` once. Accounts default to the demo seeders; override with `E2E_HOST_EMAIL`, `E2E_OPERATOR_EMAIL`, `E2E_FINANCE_EMAIL`, `E2E_ADMIN_EMAIL` and `E2E_PASSWORD`. A role whose account needs 2FA is skipped.

## How it is built

- **Every signed-in page is a client component.** `src/proxy.ts` only adds the Content-Security-Policy (a nonce per request) and `next.config.ts` the other security headers; access control happens in the browser and, for real, in the API.
- **Session:** `AuthSessionProvider` (root layout, `components/AuthProvider.tsx`) checks the Sanctum token in `localStorage` with `/auth/me` once per page load. `RequireAuth` in each area layout checks the role; `useAuth()` gives `{ token, user }` inside it. A 401, or a 403 from the auth middleware, on any request ends the session; signing out in another tab does too.
- **API:** `src/lib/api/` has one file per area on top of `client.ts` (`api`, `post`/`put`/`del`, `query`, file downloads, `ApiError`, `errorMessage`, `splitApiError`). Requests time out after 30 s. Laravel's own English messages are replaced by Indonesian ones per status.
- **Data:** `useApiData(key, load)` wraps TanStack Query (one cache entry per key; `keepPrevious` only for paged/filtered lists). A successful change marks the cache stale (opt out with `{ invalidates: false }`). `useApiForm(submit, onSuccess, shown?)` posts a form and maps Laravel 422 errors to fields; a message for a key the form has no field for is shown on top.
- **Time:** the agency runs on WIB. Server moments are formatted in `Asia/Jakarta` (`lib/format.ts`: `formatClock`, `appDate`, `appMinutes`, `appMoment`) whatever the device's zone; slot times (`"14:00"`) are WIB already.
- **Layout:** `app/(admin)`, `(operator)`, `(host)` route groups, each with its shell; `(auth)` and `(legal)` are public. Large screens are split into folders next to them (`components/payroll`, `components/backups`, `components/events`, `app/(admin)/admin/brands/_components`).
