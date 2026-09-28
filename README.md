# VidHelp — Project Structure Map

## Overview
Live streaming agency management platform with role-based access control.

---

## 📁 Folder Structure

### Backend (Laravel 13) — `backend/`

```
backend/
├── app/
│   ├── Http/
│   │   └── Controllers/
│   │       ├── Controller.php              ← Base controller
│   │       ├── Auth/
│   │       │   ├── AuthController.php      ← Login, register, logout, profile
│   │       │   └── GoogleAuthController.php ← Google OAuth redirect + callback
│   │       ├── Admin/
│   │       │   ├── DashboardController.php  ← Admin overview stats
│   │       │   ├── UserManagementController.php ← CRUD users, assign roles
│   │       │   └── FinanceController.php    ← Revenue, expenses, payroll (admin-only)
│   │       ├── Operator/
│   │       │   ├── DashboardController.php  ← Operator overview stats
│   │       │   ├── ScheduleController.php   ← CRUD schedules, assign hosts
│   │       │   ├── BackupHostController.php ← Assign backup/standby hosts
│   │       │   └── HostRatingController.php ← Rate host performance
│   │       └── Host/
│   │           ├── MyScheduleController.php ← View own schedule (read-only)
│   │           ├── ProfileController.php    ← Update profile, avatar, password
│   │           └── MyRatingController.php   ← View own ratings (read-only)
│   └── Models/
│       └── User.php                         ← HasRoles + HasApiTokens
├── database/
│   └── seeders/
│       ├── DatabaseSeeder.php
│       └── RoleSeeder.php                   ← Creates admin/operator/host roles + permissions
├── routes/
│   ├── api.php                              ← All API routes (role-based groups)
│   └── web.php
└── .env                                     ← MySQL + Sanctum + CORS configured
```

### Frontend (Next.js 15 + TypeScript + Tailwind) — `frontend/`

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx                       ← Root layout
│   │   ├── page.tsx                         ← Landing / redirect
│   │   ├── globals.css                      ← Tailwind globals
│   │   │
│   │   ├── (auth)/                          ← 🔓 Auth route group (no sidebar)
│   │   │   ├── layout.tsx                   ← Centered card, dark gradient bg
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   │
│   │   ├── (admin)/                         ← 👑 Admin route group
│   │   │   ├── layout.tsx                   ← Desktop sidebar (purple accent)
│   │   │   └── admin/
│   │   │       ├── dashboard/page.tsx       ← Stats overview
│   │   │       ├── users/page.tsx           ← User management table
│   │   │       ├── schedules/page.tsx       ← All schedules view
│   │   │       └── finance/page.tsx         ← Finance module
│   │   │
│   │   ├── (operator)/                      ← 🔧 Operator route group
│   │   │   ├── layout.tsx                   ← Desktop sidebar (blue accent)
│   │   │   └── operator/
│   │   │       ├── dashboard/page.tsx       ← Operator overview
│   │   │       ├── schedules/page.tsx       ← Schedule management
│   │   │       ├── hosts/page.tsx           ← Host list + backup assignment
│   │   │       └── ratings/page.tsx         ← Rate hosts
│   │   │
│   │   └── (host)/                          ← 📱 Host route group (MOBILE-FIRST)
│   │       ├── layout.tsx                   ← Bottom nav bar (phone-optimized)
│   │       └── host/
│   │           ├── schedule/page.tsx        ← My upcoming sessions
│   │           ├── rating/page.tsx          ← My performance ratings
│   │           └── profile/page.tsx         ← My profile settings
│   │
│   └── lib/
│       └── api.ts                           ← API client (fetch wrapper + auth)
```

---

## 🔐 Roles & Permissions

| Role | Permissions | UI Layout |
|------|------------|-----------|
| **Admin** | Everything (users, finance, schedules, ratings) | Desktop sidebar |
| **Operator** | Schedules, ratings, backup hosts, view users | Desktop sidebar |
| **Host** | View own schedule, view own ratings, edit profile | Mobile bottom nav |

## 🔑 API Route Groups

| Prefix | Middleware | Access |
|--------|-----------|--------|
| `/api/auth/*` | `throttle:10,1` | Everyone |
| `/api/admin/*` | `auth:sanctum` + `active` + `role:admin` | Admin only |
| `/api/operator/*` | `auth:sanctum` + `active` + `role:operator\|admin` | Operator + Admin |
| `/api/host/*` | `auth:sanctum` + `active` + `role:host\|operator\|admin` | All authenticated |

`active` rejects tokens of users whose `status` is no longer `active`.

## 🔓 Auth Flow
- **Sign up** (email/password or Google) → account is created as a `host` with `status=pending`.
- **Admin approves** it on `/admin/users` (Pending approval tab) → `status=active`, `approved_by`/`approved_at` recorded.
- **Sign in** with email/password or Google → Sanctum token stored in `localStorage` (`vidhelp_token`).
- **Google** redirects to the frontend `/auth/google/callback`, which sends the `code` to `GET /api/auth/google/callback`.
  An existing account with the same email gets Google linked to it.
- **Forgot password** emails a link to the frontend `/reset-password` page (with `MAIL_MAILER=log` the email is in `storage/logs/laravel.log`).
  Google-only users can use it, or the profile page, to set a password.
- The frontend layouts wrap pages in `<RequireAuth roles={...}>`, which verifies the token with `/api/auth/me`.

## 🌱 Default Admin Account
- **Email:** `admin@vidhelp.com`
- **Password:** `password`

## 📦 Installed Packages

### Backend
- **Laravel Sanctum** — API token auth
- **Spatie Permission** — Role & permission management
- **Laravel Socialite** — Google OAuth

### Frontend
- **Next.js 15** — React framework (App Router)
- **TypeScript** — Type safety
- **Tailwind CSS** — Utility-first CSS

---

## ⏭️ Next Steps
1. ~~Finalize ERD~~ · ~~Auth: login, register, Google, approval, password reset~~
2. Create migrations for schedules, ratings, etc.
3. ~~Host profiles, rate levels, brands & assignments~~
4. Connect remaining pages to the API
5. ~~Weekly schedules & host availability~~ · ~~Backups~~ · ~~Attendance & live reports~~ → next: payroll, points & ratings, special events
