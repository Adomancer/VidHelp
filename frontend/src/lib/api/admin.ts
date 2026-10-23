/** Admin: accounts, the audit log, business-rule settings, and the admin, operator and host dashboards. */

import { api, type Message, type Paginated, post, put, query } from "./client";
import type { UserStatus, RoleName, AuthUser } from "./auth";
import type { BackupReason, BackupRequestType, BackupStatus } from "./backups";
import type { LiveSession } from "./live";
import type { MyPay, PeriodStatus } from "./payroll";
import type { PointsPeriod } from "./points";

/** Why an account may be deleted permanently. */
export type EraseReason = "banned" | "host_request";

export interface AuditFilters {
  action?: string;
  target_table?: string;
  target_id?: string;
  user_id?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  target_table: string | null;
  target_id: string | null;
  target_label: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  /** Who did it; null = the system (scheduled jobs) or a failed sign-in. */
  user: { id: string; name: string; email: string } | null;
}

export const adminApi = {
  users: (token: string, params: { status?: UserStatus; search?: string; page?: number }) =>
    api<Paginated<AuthUser>>(`/admin/users${query({ ...params, page: params.page ?? 1 })}`, { token }),

  /** An account made by an admin: active straight away. */
  createUser: (token: string, data: { name: string; email: string; password: string; role: RoleName }) =>
    post<{ user: AuthUser } & Message>("/admin/users", token, data),

  activateUser: (token: string, id: string) => post(`/admin/users/${id}/activate`, token),

  /** Temporary (e.g. leave): can't sign in, schedule stays. */
  deactivateUser: (token: string, id: string) => post(`/admin/users/${id}/deactivate`, token),

  /** Resigned: can't sign in, taken off the schedule from today. */
  archiveUser: (token: string, id: string) => post(`/admin/users/${id}/archive`, token),

  /** Delete an archived account permanently: personal data wiped, work and pay history kept. */
  eraseUser: (token: string, id: string, data: { reason: EraseReason; note: string | null }) => post(`/admin/users/${id}/erase`, token, data),

  setRole: (token: string, id: string, role: RoleName) => put<{ user: AuthUser }>(`/admin/users/${id}`, token, { role }),

  /** Clear another admin's 2FA (lost phone); they set it up again at the next sign-in. */
  resetTwoFactor: (token: string, id: string) => post(`/admin/users/${id}/two-factor/reset`, token),

  auditLogs: (token: string, filters: AuditFilters & { page?: number }) =>
    api<{ logs: Paginated<AuditLogEntry>; actions: string[]; target_tables: string[] }>(`/admin/audit-logs${query(filters)}`, { token }),
};

export type SettingValue = number | boolean;

export interface Setting {
  /** Path under config/vidhelp.php, e.g. "backup.quota_per_month". */
  key: string;
  label: string;
  help: string;
  type: "int" | "bool";
  min?: number;
  max?: number;
  /** Allowed values when only a few make sense (e.g. reset every 1, 2, 3, 4, 6 or 12 months). */
  options?: number[];
  unit?: string;
  value: SettingValue;
  default: SettingValue;
  /** Set when an admin changed it from the default. */
  changed_at: string | null;
  changed_by: string | null;
}

export interface SettingGroup {
  key: string;
  label: string;
  settings: Setting[];
}

/** Rule numbers shown in help texts, readable by every signed-in user. */
export interface PublicSettings {
  /** Check-in opens this many minutes before a session starts. */
  "attendance.check_in_opens_minutes": number;
  "backup.request_min_hours_before": number;
  "backup.direct_min_hosts": number;
  "backup.direct_max_hosts": number;
  "backup.auto_fill_before_minutes": number;
  "backup.sick_letter_grace_hours": number;
  "backup.quota_per_month": number;
}

export const settingsApi = {
  public: (token: string) => api<{ settings: PublicSettings }>("/settings", { token }),

  all: (token: string) => api<{ groups: SettingGroup[] }>("/admin/settings", { token }),

  /** Only the changed keys; a value equal to the default removes the override. */
  save: (token: string, values: Record<string, SettingValue>) => put<Message & { groups: SettingGroup[] }>("/admin/settings", token, { values }),
};

/** live · done · late (started, no check-in) · missed (ended, no check-in) · upcoming */
export type SessionState = "live" | "done" | "late" | "missed" | "upcoming";

export interface TodaySession {
  host: { id: string; name: string };
  brand: { id: string; name: string };
  role: "own" | "cover" | "event";
  event_name: string | null;
  covered_for: string | null;
  start_at: string;
  end_at: string;
  check_in_at: string | null;
  state: SessionState;
}

export interface BrandProgress {
  id: string;
  name: string;
  /** Null when the brand has no payroll start date yet. */
  /** The running period; it closes when the target is reached. */
  period: { id: string; start: string; status: PeriodStatus; hours_left: number } | null;
  worked_hours?: number;
  carried_in_hours?: number;
  achieved_hours?: number;
  carried_out_hours?: number;
  target_hours?: number;
  /** Estimated host pay for the period so far (rupiah). */
  total_amount?: number;
  /** Sum of GMV on approved live reports; null if GMV isn't a report field. */
  gmv?: number | null;
}

/** An upcoming backup still without a cover. */
export interface DashboardBackup {
  id: string;
  brand: { id: string; name: string };
  requester_name: string;
  reason_type: BackupReason;
  request_type: BackupRequestType;
  start_at: string;
  end_at: string;
  status: Extract<BackupStatus, "open" | "pending">;
  /** Applicants waiting on a decision */
  applicants_count: number;
  /** When the best applicant is picked automatically */
  auto_fill_at: string | null;
}

export interface AdminDashboard {
  attention: {
    pending_signups: number;
    backups_pending: number;
    backups_uncovered_soon: number;
    reports_flagged: number;
    reports_missing: number;
    periods_to_request: number;
    periods_awaiting_brand: number;
  };
  today: { sessions: TodaySession[]; counts: Partial<Record<SessionState, number>> };
  /** Soonest first, capped; the backup desk has the rest. */
  backups: DashboardBackup[];
  brands: BrandProgress[];
  hours_by_day: { date: string; hours: number }[];
  people: { active_hosts: number; operators: number; admins: number; warning_letters: number; points_period: { start: string } };
}

/** The operator overview: counts only. */
export interface OperatorDashboard {
  stats: {
    total_hosts: number;
    active_hosts: number;
    today_schedules: number;
    pending_backups: number;
    reports_to_review: number;
  };
}

/** One of my sessions on the host dashboard; the first four fields are what check-in takes. */
export interface HostDashboardSession extends Pick<LiveSession, "slot_id" | "date" | "backup_request_id"> {
  event_claim_id: string | null;
  brand: { id: string; name: string };
  role: LiveSession["role"];
  event_name: string | null;
  /** cover: whose session I take over */
  covered_for: string | null;
  /** off: who takes over mine */
  covered_by: string | null;
  start_at: string;
  end_at: string;
  check_in_at: string | null;
  /** null when someone else covers it (role "off") */
  state: SessionState | null;
}

/** The host's own overview. */
export interface HostDashboard {
  /** Today and the 6 days after it, in time order (sessions crossing midnight into today included). */
  sessions: HostDashboardSession[];
  attention: {
    /** Over, still without a report (last 7 days) */
    reports_to_send: number;
    /** Sick leave whose doctor's letter can still come in time */
    sick_letters_due: number;
    /** My backup requests nobody covers yet */
    backups_uncovered: number;
    /** As a brand's PIC: periods that reached the target, waiting for my payment request */
    periods_to_request: number;
  };
  /** Other hosts' backups I could still apply for; asked_me = the ones that named me */
  cover_chances: { count: number; asked_me: number };
  pay: { periods: MyPay["current"]; advance_outstanding: number };
  points: { points: number; opening_points: number; sp_level: number; period: PointsPeriod };
  /** The latest monthly rating */
  rating: { month_year: string; rating: number } | null;
  rating_max: number;
  hours_by_day: { date: string; hours: number }[];
  /** Discord can be connected here and I haven't yet (reminders go there) */
  discord_unlinked: boolean;
}

export const dashboardApi = {
  admin: (token: string) => api<AdminDashboard>("/admin/dashboard", { token }),
  operator: (token: string) => api<OperatorDashboard>("/operator/dashboard", { token }),
  host: (token: string) => api<HostDashboard>("/host/dashboard", { token }),
};
