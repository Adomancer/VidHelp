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
| `/api/auth/*` | Public | Everyone |
| `/api/admin/*` | `auth:sanctum` + `role:admin` | Admin only |
| `/api/operator/*` | `auth:sanctum` + `role:operator\|admin` | Operator + Admin |
| `/api/host/*` | `auth:sanctum` + `role:host\|operator\|admin` | All authenticated |

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
1. Finalize ERD (database schema)
2. Create migrations for schedules, ratings, etc.
3. Build out the login/register UI
4. Connect frontend to backend API
5. Implement the schedule management feature
