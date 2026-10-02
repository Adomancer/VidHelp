const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface FetchOptions extends RequestInit {
  token?: string;
}

/**
 * Send a request to the Laravel backend with auth token injection.
 * FormData bodies (file uploads) are sent as multipart; everything else as JSON.
 */
async function request(endpoint: string, options: FetchOptions = {}): Promise<Response> {
  const { token, headers, ...rest } = options;

  const defaultHeaders: Record<string, string> = {
    Accept: "application/json",
  };

  if (!(rest.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  if (token) {
    defaultHeaders["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      ...defaultHeaders,
      ...headers,
    },
    ...rest,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(response.status, error.message || "API request failed", error);
  }

  return response;
}

/** JSON API call. */
export async function api<T = unknown>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  return (await request(endpoint, options)).json();
}

/** Download a protected file (e.g. a KTP photo) as an object URL for <img src>. */
export async function apiFileUrl(endpoint: string, token: string): Promise<string> {
  return URL.createObjectURL(await (await request(endpoint, { token })).blob());
}

/**
 * Custom error class for API errors.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** First Laravel validation message per field, e.g. { email: "The email field is required." } */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};

  const errors = (error.data?.errors ?? {}) as Record<string, string[]>;
  return Object.fromEntries(Object.entries(errors).map(([field, messages]) => [field, messages[0]]));
}

/** A message to show the user for any failed request. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Could not reach the server. Is the backend running?";
}

/*
|--------------------------------------------------------------------------
| Auth API
|--------------------------------------------------------------------------
*/
export type UserStatus = "pending" | "active" | "inactive" | "archived";

export type RoleName = "admin" | "operator" | "finance" | "host";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  avatar_url: string | null;
  status: UserStatus;
  signup_source: "admin_created" | "self_register";
  has_password: boolean;
  two_factor_enabled: boolean;
  /** Admin who must set up 2FA before using the app (only sent with login and /auth/me). */
  two_factor_setup_required?: boolean;
  approved_at: string | null;
  last_login_at: string | null;
  /** Set once an admin deleted the account permanently (personal data wiped). */
  erased_at: string | null;
  created_at: string;
  roles: { name: RoleName }[];
}

/** Returned when login succeeds. */
export interface AuthSession {
  user: AuthUser;
  token: string;
}

/** Returned instead of a session when an admin with 2FA must enter a code next. */
export interface TwoFactorChallenge {
  two_factor: true;
  challenge_token: string;
  message: string;
}

/** Returned when an account was created but still needs admin approval. */
export interface PendingSignup {
  message: string;
  status: "pending";
}

export interface Message {
  message: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    api<AuthSession | TwoFactorChallenge>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  /** Second sign-in step: a code from the authenticator app, or a recovery code. */
  twoFactorChallenge: (challengeToken: string, answer: { code: string } | { recovery_code: string }) =>
    api<AuthSession>("/auth/two-factor-challenge", {
      method: "POST",
      body: JSON.stringify({ challenge_token: challengeToken, ...answer }),
    }),

  register: (data: { name: string; email: string; password: string; password_confirmation: string }) =>
    api<PendingSignup>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  logout: (token: string) =>
    api<Message>("/auth/logout", { method: "POST", token }),

  me: (token: string) =>
    api<{ user: AuthUser }>("/auth/me", { token }),

  forgotPassword: (email: string) =>
    api<Message>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (data: { token: string; email: string; password: string; password_confirmation: string }) =>
    api<Message>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** current_password is only required when the user already has a password. */
  changePassword: (token: string, data: { current_password?: string; password: string; password_confirmation: string }) =>
    api<Message>("/host/profile/password", {
      method: "POST",
      body: JSON.stringify(data),
      token,
    }),

  googleRedirect: () =>
    api<{ url: string }>("/auth/google/redirect"),

  /** Exchange the authorization code Google redirected back with. */
  googleCallback: (code: string) =>
    api<AuthSession | PendingSignup | TwoFactorChallenge>(`/auth/google/callback?code=${encodeURIComponent(code)}`),
};

/*
|--------------------------------------------------------------------------
| Two-factor authentication (admins)
|--------------------------------------------------------------------------
*/
export interface TwoFactorStatus {
  available: boolean;
  required: boolean;
  enabled: boolean;
  enabled_at: string | null;
  recovery_codes_left: number;
}

export const twoFactorApi = {
  status: (token: string) => api<TwoFactorStatus>("/two-factor", { token }),

  /** A fresh secret; 2FA turns on only after confirm() with a code from the app. */
  setup: (token: string) => api<{ secret: string; otpauth_url: string }>("/two-factor/setup", { method: "POST", token }),

  confirm: (token: string, code: string) =>
    api<Message & { recovery_codes: string[]; user: AuthUser }>("/two-factor/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
      token,
    }),

  regenerateRecoveryCodes: (token: string, code: string) =>
    api<Message & { recovery_codes: string[] }>("/two-factor/recovery-codes", {
      method: "POST",
      body: JSON.stringify({ code }),
      token,
    }),

  disable: (token: string, code: string) =>
    api<Message>("/two-factor", { method: "DELETE", body: JSON.stringify({ code }), token }),
};

/*
|--------------------------------------------------------------------------
| Admin API
|--------------------------------------------------------------------------
*/
export interface Paginated<T> {
  data: T[];
  current_page: number;
  last_page: number;
  total: number;
}

/** Why an account may be deleted permanently. */
export type EraseReason = "banned" | "host_request";

export const adminApi = {
  users: (token: string, params: { status?: UserStatus; search?: string; page?: number }) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.search) query.set("search", params.search);
    query.set("page", String(params.page ?? 1));

    return api<Paginated<AuthUser>>(`/admin/users?${query}`, { token });
  },

  /** An account made by an admin: active straight away. */
  createUser: (token: string, data: { name: string; email: string; password: string; role: RoleName }) =>
    api<{ user: AuthUser } & Message>("/admin/users", { method: "POST", body: JSON.stringify(data), token }),

  activateUser: (token: string, id: string) =>
    api<Message>(`/admin/users/${id}/activate`, { method: "POST", token }),

  /** Temporary (e.g. leave): can't sign in, schedule stays. */
  deactivateUser: (token: string, id: string) =>
    api<Message>(`/admin/users/${id}/deactivate`, { method: "POST", token }),

  /** Resigned: can't sign in, taken off the schedule from today. */
  archiveUser: (token: string, id: string) =>
    api<Message>(`/admin/users/${id}/archive`, { method: "POST", token }),

  /** Delete an archived account permanently: personal data wiped, work and pay history kept. */
  eraseUser: (token: string, id: string, data: { reason: EraseReason; note: string | null }) =>
    api<Message>(`/admin/users/${id}/erase`, { method: "POST", body: JSON.stringify(data), token }),

  setRole: (token: string, id: string, role: RoleName) =>
    api<{ user: AuthUser }>(`/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify({ role }),
      token,
    }),

  /** Clear another admin's 2FA (lost phone); they set it up again at the next sign-in. */
  resetTwoFactor: (token: string, id: string) =>
    api<Message>(`/admin/users/${id}/two-factor/reset`, { method: "POST", token }),

  auditLogs: (token: string, filters: AuditFilters & { page?: number }) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, String(value)]));
    return api<{ logs: Paginated<AuditLogEntry>; actions: string[]; target_tables: string[] }>(`/admin/audit-logs?${query}`, { token });
  },
};

/*
|--------------------------------------------------------------------------
| Settings (admin-editable business rules)
|--------------------------------------------------------------------------
*/
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
  save: (token: string, values: Record<string, SettingValue>) =>
    api<Message & { groups: SettingGroup[] }>("/admin/settings", { method: "PUT", body: JSON.stringify({ values }), token }),
};

/*
|--------------------------------------------------------------------------
| Dashboards
|--------------------------------------------------------------------------
*/
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
  period: { id: string; start: string; end: string; status: PeriodStatus; days_left: number } | null;
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
  brands: BrandProgress[];
  hours_by_day: { date: string; hours: number }[];
  people: { active_hosts: number; operators: number; admins: number; warning_letters: number; points_period: { start: string } };
}

export const dashboardApi = {
  admin: (token: string) => api<AdminDashboard>("/admin/dashboard", { token }),
};

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

export const adminHostsApi = {
  rateCategories: (token: string) =>
    api<{ rate_categories: (RateCategory & { hosts_count: number })[] }>("/admin/rate-categories", { token }),

  createRateCategory: (token: string, data: RateCategoryInput) =>
    api<{ rate_category: RateCategory }>("/admin/rate-categories", { method: "POST", body: JSON.stringify(data), token }),

  updateRateCategory: (token: string, id: string, data: Partial<RateCategoryInput>) =>
    api<{ rate_category: RateCategory }>(`/admin/rate-categories/${id}`, { method: "PUT", body: JSON.stringify(data), token }),

  deleteRateCategory: (token: string, id: string) =>
    api<Message>(`/admin/rate-categories/${id}`, { method: "DELETE", token }),

  createBrand: (token: string, data: BrandInput) =>
    api<{ brand: Brand }>("/admin/brands", { method: "POST", body: JSON.stringify(data), token }),

  updateBrand: (token: string, id: string, data: Partial<BrandInput>) =>
    api<{ brand: Brand }>(`/admin/brands/${id}`, { method: "PUT", body: JSON.stringify(data), token }),

  host: (token: string, id: string) =>
    api<{ host: AdminHostDetail }>(`/admin/hosts/${id}`, { token }),

  /** rate_category_id: an id pins the level by hand, null returns it to automatic. */
  updateHost: (token: string, id: string, data: AdminHostInput) =>
    api<{ host: AdminHostDetail }>(`/admin/hosts/${id}`, { method: "PUT", body: JSON.stringify(data), token }),

  ktpImageUrl: (token: string, id: string) => apiFileUrl(`/admin/hosts/${id}/ktp-image`, token),
};

/*
|--------------------------------------------------------------------------
| Hosts, brands & rate levels
|--------------------------------------------------------------------------
*/
export type HostStatus = "active" | "inactive" | "archived" | "banned";
export type AssignmentStatus = "active" | "inactive" | "banned";

export interface RateCategory {
  id: string;
  name: string;
  min_tenure_months: number;
  rate_per_hour: string;
}

export type RateCategoryInput = Pick<RateCategory, "name" | "min_tenure_months"> & { rate_per_hour: number };

export interface Brand {
  id: string;
  name: string;
  is_obs: boolean;
  target_hours_per_period: number;
  payment_cycle_days: number;
  /** First day of the first payment period; later periods follow back to back */
  payroll_start_date?: string | null;
  status: "active" | "inactive";
}

export type BrandInput = Omit<Brand, "id">;

export interface BrandSummary extends Brand {
  active_hosts_count: number;
  leader: { id: string; name: string } | null;
}

export interface Assignment {
  id: string;
  host_id: string;
  brand_id: string;
  is_leader: boolean;
  status: AssignmentStatus;
  brand: Pick<Brand, "id" | "name"> & Partial<Brand>;
}

/** What hosts (and admins) see: numbers masked. */
export interface SensitiveDataMasked {
  bank_name: string | null;
  account_holder_name: string | null;
  ktp_number_masked: string | null;
  bank_account_masked: string | null;
  has_ktp_image: boolean;
}

export interface HostProfile {
  id: string;
  user_id: string;
  rate_category_id: string | null;
  rate_category_overridden: boolean;
  phone: string | null;
  guardian_phone: string | null;
  join_date: string;
  status: HostStatus;
  updated_at: string;
  rate_category: RateCategory | null;
}

export interface MyProfile {
  user: AuthUser;
  host_profile: (HostProfile & { sensitive_data: SensitiveDataMasked | null; assignments: Assignment[] }) | null;
}

export interface HostListItem extends HostProfile {
  user: AuthUser;
  assignments: Assignment[];
}

export interface AdminHostDetail extends HostListItem {
  sensitive_data: (SensitiveDataMasked & { ktp_number: string | null; bank_account: string | null }) | null;
}

/** Host status follows the account's (Users page), so it isn't set here. */
export type AdminHostInput = Partial<Pick<HostProfile, "phone" | "guardian_phone" | "join_date" | "rate_category_id">>;

export const hostApi = {
  profile: (token: string) => api<MyProfile>("/host/profile", { token }),

  updateProfile: (token: string, data: { name?: string; phone?: string | null; guardian_phone?: string | null }) =>
    api<MyProfile & Message>("/host/profile", { method: "PUT", body: JSON.stringify(data), token }),

  uploadPhoto: (token: string, photo: File) => {
    const body = new FormData();
    body.append("photo", photo);
    return api<MyProfile & Message>("/host/profile/photo", { method: "POST", body, token });
  },

  updateSensitive: (
    token: string,
    data: { ktp_number?: string; bank_name?: string; bank_account?: string; account_holder_name?: string }
  ) => api<MyProfile & Message>("/host/profile/sensitive", { method: "PUT", body: JSON.stringify(data), token }),

  uploadKtpImage: (token: string, image: File) => {
    const body = new FormData();
    body.append("ktp_image", image);
    return api<MyProfile & Message>("/host/profile/ktp-image", { method: "POST", body, token });
  },
};

export const operatorApi = {
  hosts: (token: string, params: { search?: string; brand_id?: string; page?: number }) => {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.brand_id) query.set("brand_id", params.brand_id);
    query.set("page", String(params.page ?? 1));

    return api<Paginated<HostListItem>>(`/operator/hosts?${query}`, { token });
  },

  brands: (token: string) => api<{ brands: BrandSummary[] }>("/operator/brands", { token }),

  assign: (token: string, data: { host_id: string; brand_id: string; is_leader?: boolean }) =>
    api<{ assignment: Assignment }>("/operator/assignments", { method: "POST", body: JSON.stringify(data), token }),

  updateAssignment: (token: string, id: string, data: { is_leader?: boolean; status?: AssignmentStatus }) =>
    api<{ assignment: Assignment }>(`/operator/assignments/${id}`, { method: "PUT", body: JSON.stringify(data), token }),
};

/*
|--------------------------------------------------------------------------
| Schedules & availability
|--------------------------------------------------------------------------
*/
/** ISO weekday: 1 = Monday ... 7 = Sunday */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ScheduleSlot {
  id: string;
  assignment_id: string;
  day_of_week: DayOfWeek;
  slot_type: "regular" | "pd";
  /** "HH:MM" */
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  is_locked: boolean;
  status: "active" | "inactive";
  effective_from: string;
  effective_to: string | null;
  assignment: Assignment & { host?: HostProfile & { user: AuthUser } };
}

export interface SlotInput {
  assignment_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_type: ScheduleSlot["slot_type"];
  effective_from: string;
  effective_to: string | null;
}

export interface AvailabilityRange {
  day_of_week: DayOfWeek;
  available_from: string;
  available_to: string;
  note: string | null;
}

export interface BrandHost extends Omit<Assignment, "brand"> {
  host: HostProfile & { user: AuthUser; availability: AvailabilityRange[] };
}

export const scheduleApi = {
  list: (token: string, params: { brand_id?: string; host_id?: string; on?: string }) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value) as [string, string][]);
    return api<{ slots: ScheduleSlot[]; backups: SlotBackupMarker[]; replacing_events: ReplacingEvent[] }>(`/operator/schedules?${query}`, { token });
  },

  brandHosts: (token: string, brandId: string) => api<{ assignments: BrandHost[] }>(`/operator/brands/${brandId}/hosts`, { token }),

  create: (token: string, data: SlotInput) =>
    api<{ slot: ScheduleSlot }>("/operator/schedules", { method: "POST", body: JSON.stringify(data), token }),

  update: (token: string, id: string, data: Partial<SlotInput>) =>
    api<{ slot: ScheduleSlot }>(`/operator/schedules/${id}`, { method: "PUT", body: JSON.stringify(data), token }),

  /** Ends the slot from today on (deletes it if it hasn't started yet). */
  remove: (token: string, id: string) => api<Message>(`/operator/schedules/${id}`, { method: "DELETE", token }),

  /** Admin only. */
  lock: (token: string, id: string, isLocked: boolean) =>
    api<{ slot: ScheduleSlot }>(`/admin/schedules/${id}/lock`, { method: "PUT", body: JSON.stringify({ is_locked: isLocked }), token }),

  /** covers: backups I do for others; absences: my sessions someone else covers (next 7 days). */
  mine: (token: string) =>
    api<{
      slots: ScheduleSlot[];
      upcoming: ScheduleSlot[];
      covers: BackupNeed[];
      absences: SlotBackupMarker[];
      event_claims: MyEventClaim[];
      replacing_events: ReplacingEvent[];
    }>("/host/schedules", { token }),

  myAvailability: (token: string) => api<{ availability: AvailabilityRange[] }>("/host/availability", { token }),

  saveAvailability: (token: string, ranges: AvailabilityRange[]) =>
    api<{ availability: AvailabilityRange[] } & Message>("/host/availability", { method: "PUT", body: JSON.stringify({ ranges }), token }),
};

/*
|--------------------------------------------------------------------------
| Backups
|--------------------------------------------------------------------------
*/
/** open = no applicants yet · pending = applicants wait for the admin's decision */
export type BackupStatus = "pending" | "open" | "filled" | "cancelled" | "rejected";
export type BackupReason = "sick" | "permit" | "other";
/** open = every host may apply · direct = only the hosts the requester named */
export type BackupRequestType = "open" | "direct";
export type LetterStatus = "not_needed" | "uploaded" | "due" | "late";

type HostWithUser = HostProfile & { user: AuthUser };

export interface BackupRequest {
  id: string;
  slot_id: string;
  brand_id: string;
  requesting_host_id: string;
  backup_date: string;
  /** ISO datetimes */
  start_at: string;
  end_at: string;
  reason_type: BackupReason;
  reason: string | null;
  request_type: BackupRequestType;
  status: BackupStatus;
  /** When the cover was approved (by an admin, or automatically) */
  approved_at: string | null;
  auto_fill_at: string;
  auto_filled: boolean;
  counts_toward_quota: boolean;
  filled_by_host_id: string | null;
  letter_status: LetterStatus;
  letter_due_at: string | null;
  brand: { id: string; name: string };
  requester?: HostWithUser;
  filler?: HostWithUser | null;
  attachments?: { id: string; original_name: string | null; created_at: string }[];
  /** Hosts named on a direct request */
  nominees?: { id: string; nominee_host_id: string; host: HostWithUser }[];
  applicants_count?: number;
}

/** What hosts see about someone else's request (no reason). */
export interface BackupNeed {
  id: string;
  brand: { id: string; name: string };
  requester_name: string;
  backup_date: string;
  start_at: string;
  end_at: string;
  status: BackupStatus;
  request_type: BackupRequestType;
  nominee_names: string[];
  /** The requester named me */
  asked_me?: boolean;
  same_brand?: boolean;
  my_application?: { id: string; status: "applied" | "approved" | "rejected" | "withdrawn" | "cancelled" } | null;
  ineligible_reason?: string | null;
}

export interface SlotOccurrence {
  slot_id: string;
  date: string;
  start_at: string;
  end_at: string;
  brand: { id: string; name: string };
}

export interface BackupQuota {
  month_year?: string;
  quota_used: number;
  quota_max: number;
}

export interface BackupCandidate {
  host_id: string;
  name: string;
  avatar_url: string | null;
  same_brand: boolean;
  rating?: number | null;
  eligible: boolean;
  ineligible_reason: string | null;
  quota: BackupQuota;
  applied_at?: string;
}

/** A host the requester may name (no rating or quota shown to other hosts). */
export type NomineeCandidate = Pick<BackupCandidate, "host_id" | "name" | "avatar_url" | "same_brand" | "eligible" | "ineligible_reason">;

/** A backup on one date of a weekly slot, for marking schedules. */
export interface SlotBackupMarker {
  id: string;
  slot_id: string;
  backup_date: string;
  status: "pending" | "open" | "filled";
  filler_name: string | null;
}

export interface BackupRequestInput {
  slot_id: string;
  backup_date: string;
  reason_type: BackupReason;
  reason: string | null;
}

/** A host's own request: open to all, or to named hosts, optionally with the sick letter. */
export interface HostBackupRequestInput extends BackupRequestInput {
  request_type: BackupRequestType;
  host_ids: string[];
  letter: File | null;
}

const post = <T = Message>(endpoint: string, token: string, body?: unknown) =>
  api<T>(endpoint, { method: "POST", token, body: body === undefined ? undefined : JSON.stringify(body) });

export const hostBackupApi = {
  mine: (token: string) =>
    api<{ requests: BackupRequest[]; covers: BackupNeed[]; quota: BackupQuota }>("/host/backups", { token }),
  needs: (token: string) => api<{ needs: BackupNeed[] }>("/host/backups/needs", { token }),
  slots: (token: string) => api<{ slots: SlotOccurrence[] }>("/host/backups/slots", { token }),
  /** Hosts I could name for a direct request on one of my sessions. */
  candidates: (token: string, slotId: string, date: string) =>
    api<{ candidates: NomineeCandidate[] }>(`/host/backups/candidates?slot_id=${slotId}&backup_date=${date}`, { token }),
  request: (token: string, data: HostBackupRequestInput) => {
    const body = new FormData();
    body.append("slot_id", data.slot_id);
    body.append("backup_date", data.backup_date);
    body.append("reason_type", data.reason_type);
    if (data.reason) body.append("reason", data.reason);
    body.append("request_type", data.request_type);
    if (data.request_type === "direct") data.host_ids.forEach((id) => body.append("host_ids[]", id));
    if (data.letter) body.append("letter", data.letter);
    return api<{ request: BackupRequest } & Message>("/host/backups", { method: "POST", body, token });
  },
  cancel: (token: string, id: string) => post(`/host/backups/${id}/cancel`, token),
  uploadLetter: (token: string, id: string, letter: File) => {
    const body = new FormData();
    body.append("letter", letter);
    return api<{ request: BackupRequest } & Message>(`/host/backups/${id}/letter`, { method: "POST", body, token });
  },
  apply: (token: string, id: string) => post(`/host/backups/${id}/apply`, token),
  withdraw: (token: string, id: string) => post(`/host/backups/${id}/withdraw`, token),
  /** Drop a backup you were picked for (point penalty). */
  drop: (token: string, id: string) => post(`/host/backups/${id}/drop`, token),
};

export const operatorBackupApi = {
  list: (token: string, status: "pending" | "open" | "filled" | "closed") =>
    api<{ requests: BackupRequest[] }>(`/operator/backups?status=${status}`, { token }),
  create: (token: string, data: BackupRequestInput) => post<{ request: BackupRequest } & Message>("/operator/backups", token, data),
  applicants: (token: string, id: string) => api<{ applicants: BackupCandidate[] }>(`/operator/backups/${id}/applicants`, { token }),
  candidates: (token: string, id: string) => api<{ candidates: BackupCandidate[] }>(`/operator/backups/${id}/candidates`, { token }),
  /** Turn an applicant down; with nobody else waiting, the request is open again. */
  rejectApplicant: (token: string, id: string, hostId: string) =>
    post(`/operator/backups/${id}/reject-applicant`, token, { host_id: hostId }),
  cancel: (token: string, id: string) => post(`/operator/backups/${id}/cancel`, token),
  /** Approve (ACC) a cover: an applicant, or any free host in an emergency. */
  assign: (token: string, id: string, hostId: string) => post(`/operator/backups/${id}/assign`, token, { host_id: hostId }),
  unassign: (token: string, id: string) => post(`/operator/backups/${id}/unassign`, token),
  letterUrl: (token: string, id: string) => apiFileUrl(`/operator/backups/${id}/letter`, token),
};

/*
|--------------------------------------------------------------------------
| Attendance & live reports
|--------------------------------------------------------------------------
*/
export type ReportStatus = "submitted" | "flagged" | "approved" | "rejected";

export interface LiveReport {
  id: string;
  attendance_id: string;
  session_count: number;
  duration_hours: number;
  metrics: Record<string, number> | null;
  notes: string | null;
  status: ReportStatus;
  flag_reasons: string[] | null;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface Attendance {
  id: string;
  /** null for event blocks */
  slot_id: string | null;
  backup_request_id: string | null;
  event_claim_id?: string | null;
  session_date: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  check_in_at: string;
  check_out_at: string | null;
  report_due_at: string;
  report?: LiveReport | null;
  brand?: { id: string; name: string };
  host?: HostWithUser;
}

/** One session occurrence on the host's Live page. */
export interface LiveSession {
  /** null for event blocks */
  slot_id: string | null;
  date: string;
  backup_request_id: string | null;
  event_claim_id?: string | null;
  event_name?: string;
  brand: { id: string; name: string };
  start_at: string;
  end_at: string;
  /** own = my slot, off = someone covers me, cover = I cover someone, event = a claimed event block */
  role: "own" | "off" | "cover" | "event";
  covered_by?: string | null;
  covered_for?: string;
  attendance: Attendance | null;
}

export interface ReportInput {
  session_count: number;
  duration_hours: number;
  metrics: Record<string, number | null>;
  notes: string | null;
}

export interface ReviewReport extends LiveReport {
  brand: { id: string; name: string };
  host: HostWithUser;
  attendance: Attendance;
  reviewer: { id: string; name: string } | null;
  scheduled_hours: number;
  attended_hours: number | null;
}

export const liveApi = {
  today: (token: string) =>
    api<{ sessions: LiveSession[]; missing_reports: Attendance[]; metrics: string[] }>("/host/live", { token }),
  checkIn: (token: string, session: Pick<LiveSession, "slot_id" | "date" | "backup_request_id" | "event_claim_id">) =>
    post<{ attendance: Attendance } & Message>("/host/live/check-in", token, session),
  checkOut: (token: string, attendanceId: string) => post<{ attendance: Attendance } & Message>(`/host/live/${attendanceId}/check-out`, token),
  report: (token: string, attendanceId: string, data: ReportInput) =>
    post<{ report: LiveReport } & Message>(`/host/live/${attendanceId}/report`, token, data),
};

export const reportApi = {
  list: (token: string, status: "flagged" | "approved" | "rejected") =>
    api<{ reports: ReviewReport[]; metrics: string[] }>(`/operator/reports?status=${status}`, { token }),
  missing: (token: string) => api<{ attendances: Attendance[] }>("/operator/reports?status=missing", { token }),
  approve: (token: string, id: string, data: { duration_hours: number; review_note: string | null }) =>
    post(`/operator/reports/${id}/approve`, token, data),
  reject: (token: string, id: string, reviewNote: string) => post(`/operator/reports/${id}/reject`, token, { review_note: reviewNote }),
};

/*
|--------------------------------------------------------------------------
| Points, warning letters (SP) & ratings
|--------------------------------------------------------------------------
*/
export interface ViolationType {
  id: string;
  name: string;
  code: string | null;
  default_points: number;
  rating_impact: number;
  is_active: boolean;
}

export interface PointLog {
  id: string;
  source: "internal" | "brand_complaint" | "backup_cancel" | "late_attachment";
  points_change: number;
  reason: string | null;
  occurred_on: string;
  voided_at?: string | null;
  violation_type: { id: string; name: string } | null;
  recorder?: { id: string; name: string } | null;
  brand_complaint?: { id: string; description: string; brand: { id: string; name: string } } | null;
}

export interface WarningLetter {
  id: string;
  level: 1 | 2 | 3;
  reason: string;
  issued_at: string;
  period_start: string;
  voided_at?: string | null;
  issuer?: { id: string; name: string } | null;
}

export interface HostRating {
  id: string;
  month_year: string;
  rating: number;
  suggested_rating?: number | null;
  note: string | null;
  rater?: { id: string; name: string } | null;
}

export interface PointsPeriod {
  start: string;
  end: string;
}

/** SP level → points threshold, e.g. { 1: 75, 2: 50, 3: 25 } */
export type SpThresholds = Record<string, number>;

export interface PointsHostRow {
  host_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  points: number;
  sp_level: number;
  deductions: number;
}

export interface PointsHostDetail {
  host: HostProfile & { user: AuthUser };
  period: PointsPeriod;
  points: number;
  opening_points: number;
  thresholds: SpThresholds;
  logs: PointLog[];
  warning_letters: WarningLetter[];
  ratings: HostRating[];
}

export interface RatingRow {
  host_id: string;
  name: string;
  avatar_url: string | null;
  violations: number;
  suggested: number;
  rating: HostRating | null;
}

export const pointsApi = {
  hosts: (token: string, search = "") =>
    api<{ period: PointsPeriod; thresholds: SpThresholds; hosts: PointsHostRow[] }>(
      `/operator/points${search ? `?search=${encodeURIComponent(search)}` : ""}`,
      { token }
    ),
  host: (token: string, hostId: string, on?: string) =>
    api<PointsHostDetail>(`/operator/points/hosts/${hostId}${on ? `?on=${on}` : ""}`, { token }),
  violationTypes: (token: string) => api<{ violation_types: ViolationType[] }>("/operator/violation-types", { token }),
  recordViolation: (
    token: string,
    data: { host_id: string; violation_type_id: string; points: number | null; reason: string | null; occurred_on: string }
  ) => post<{ points: number; warning_letter: WarningLetter | null } & Message>("/operator/points/violations", token, data),
  recordComplaint: (
    token: string,
    data: { host_id: string; brand_id: string; description: string; points: number | null; occurred_on: string }
  ) => post<{ points?: number; warning_letter?: WarningLetter | null } & Message>("/operator/points/complaints", token, data),

  // Admin only
  voidLog: (token: string, logId: string) => post<{ points: number } & Message>(`/admin/points/logs/${logId}/void`, token),
  issueWarning: (token: string, data: { host_id: string; level: number; reason: string }) =>
    post<{ warning_letter: WarningLetter } & Message>("/admin/warning-letters", token, data),
  voidWarning: (token: string, letterId: string) => post(`/admin/warning-letters/${letterId}/void`, token),
  allViolationTypes: (token: string) => api<{ violation_types: ViolationType[] }>("/admin/violation-types", { token }),
  createViolationType: (token: string, data: Pick<ViolationType, "name" | "default_points" | "rating_impact">) =>
    post<{ violation_type: ViolationType } & Message>("/admin/violation-types", token, data),
  updateViolationType: (token: string, id: string, data: Partial<Pick<ViolationType, "name" | "default_points" | "rating_impact" | "is_active">>) =>
    api<{ violation_type: ViolationType } & Message>(`/admin/violation-types/${id}`, { method: "PUT", body: JSON.stringify(data), token }),
  ratings: (token: string, month: string) =>
    api<{ month: string; scale: { min: number; max: number }; hosts: RatingRow[] }>(`/admin/ratings?month=${month}`, { token }),
  rate: (token: string, data: { host_id: string; month_year: string; rating: number; note: string | null }) =>
    api<{ rating: HostRating } & Message>("/admin/ratings", { method: "PUT", body: JSON.stringify(data), token }),
};

export interface Performance {
  period: PointsPeriod;
  points: number;
  opening_points: number;
  thresholds: SpThresholds;
  logs: PointLog[];
  warning_letters: WarningLetter[];
  ratings: HostRating[];
}

export const performanceApi = {
  mine: (token: string) => api<Performance>("/host/performance", { token }),
};

/*
|--------------------------------------------------------------------------
| Special events (PD, double date)
|--------------------------------------------------------------------------
*/
export interface SpecialEvent {
  id: string;
  brand_id: string;
  name: string;
  start_date: string;
  end_date: string;
  /** "HH:MM"; an end before the start runs past midnight */
  daily_start_time: string;
  daily_end_time: string;
  block_minutes: number;
  open_full_schedule: boolean;
  max_slots_per_host: number;
  status: "active" | "cancelled";
  brand?: { id: string; name: string };
}

export interface EventListItem extends SpecialEvent {
  claimed_blocks: number;
  total_blocks: number;
}

/** mine | taken | past | unavailable (brand's regular schedule) | busy (you) | free */
export type BlockState = "mine" | "taken" | "past" | "unavailable" | "busy" | "free";

export interface EventBlock {
  start_at: string;
  end_at: string;
  state: BlockState;
  reason: string | null;
  claim: { id: string; host_id: string; host_name: string } | null;
}

export interface HostEvent extends SpecialEvent {
  my_claims: number;
  blocks: EventBlock[];
}

/** A block I claimed, as shown on my schedule. */
export interface MyEventClaim {
  id: string;
  event_name: string;
  brand: { id: string; name: string };
  date: string;
  start_at: string;
  end_at: string;
}

/** An event whose days replace a brand's regular schedule. */
export interface ReplacingEvent {
  id: string;
  brand_id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export type EventInput = Omit<SpecialEvent, "id" | "status" | "brand">;

export const eventApi = {
  list: (token: string) => api<{ events: EventListItem[] }>("/operator/events", { token }),
  show: (token: string, id: string) => api<{ event: SpecialEvent; blocks: EventBlock[] }>(`/operator/events/${id}`, { token }),
  create: (token: string, data: EventInput) => post<{ event: SpecialEvent } & Message>("/operator/events", token, data),
  update: (token: string, id: string, data: Partial<Pick<SpecialEvent, "name" | "open_full_schedule" | "max_slots_per_host">>) =>
    api<{ event: SpecialEvent } & Message>(`/operator/events/${id}`, { method: "PUT", body: JSON.stringify(data), token }),
  cancel: (token: string, id: string) => post(`/operator/events/${id}/cancel`, token),
  assign: (token: string, id: string, startAt: string, hostId: string) =>
    post(`/operator/events/${id}/assign`, token, { start_at: startAt, host_id: hostId }),
  release: (token: string, claimId: string) => post(`/operator/event-claims/${claimId}/release`, token),

  // Hosts
  mine: (token: string) => api<{ events: HostEvent[] }>("/host/events", { token }),
  claim: (token: string, id: string, startAt: string) => post(`/host/events/${id}/claim`, token, { start_at: startAt }),
  cancelClaim: (token: string, claimId: string) => post(`/host/event-claims/${claimId}/cancel`, token),
};

/*
|--------------------------------------------------------------------------
| Payroll, salary slips & kasbon
|--------------------------------------------------------------------------
*/
export type PeriodStatus = "in_progress" | "waiting_payment" | "requested" | "paid";

export interface PeriodSummary {
  worked_hours: number;
  carried_in_hours: number;
  /** Billable to the brand: worked + carried in, capped at the target */
  achieved_hours: number;
  carried_out_hours: number;
  target_hours: number;
  total_amount: number;
}

export interface PaymentPeriod {
  id: string;
  brand_id: string;
  period_start: string;
  period_end: string;
  status: PeriodStatus;
  locked_at: string | null;
  brand?: { id: string; name: string };
  payment_request?: {
    id: string;
    status: "requested" | "processing" | "paid";
    requested_at: string;
    paid_at: string | null;
    requester?: { id: string; name: string } | null;
  } | null;
}

export interface PeriodListItem extends PaymentPeriod, PeriodSummary {
  hosts: number;
}

export interface HostPayRow {
  host_id: string;
  name: string;
  session_count: number;
  hours: number;
  rate_per_hour: number;
  amount: number;
  /** true while the period is open: at today's rate, not final */
  estimate: boolean;
}

export interface HourAdjustment {
  id: string;
  host_id: string;
  sessions_added: number;
  hours_added: number;
  notes: string;
  created_at: string;
  host: HostWithUser;
  creator: { id: string; name: string } | null;
}

export interface SalarySlipRow {
  id: string;
  host_id: string;
  gross_amount: number;
  advance_deduction: number;
  net_amount: number;
  generated_at: string;
  host?: HostWithUser;
}

export interface SlipDetail {
  id: string;
  host_name: string;
  brand: { id: string; name: string };
  period_start: string;
  period_end: string;
  session_count: number;
  hours: number;
  rate_per_hour: number;
  gross_amount: number;
  advance_deduction: number;
  net_amount: number;
  deductions: { type: "early_payment" | "loan"; seq: number; installment_count: number; amount: number }[];
  bank: { bank_name: string | null; account: string | null; holder: string | null } | null;
  generated_at: string;
}

export interface CashAdvance {
  id: string;
  host_id: string;
  type: "early_payment" | "loan";
  total_amount: number;
  installment_count: number;
  notes: string | null;
  status: "unpaid" | "in_progress" | "paid";
  requested_at: string;
  deducted_amount: number;
  host: HostWithUser;
  brand: { id: string; name: string } | null;
  installments: { id: string; seq: number; amount: number; status: "scheduled" | "deducted" | "skipped"; deducted_at: string | null }[];
}

export const payrollApi = {
  /** Brands with their payroll start date (finance can't use the operator brand list). */
  brands: (token: string) =>
    api<{ brands: Pick<Brand, "id" | "name" | "status" | "payroll_start_date">[] }>("/finance/brands", { token }),
  /** Active hosts to pick for kasbon or an adjustment; with brandId, only that brand's. */
  hosts: (token: string, brandId = "") =>
    api<{ hosts: { host_id: string; name: string }[] }>(`/finance/hosts${brandId ? `?brand_id=${brandId}` : ""}`, { token }),
  periods: (token: string, brandId = "") =>
    api<{ periods: PeriodListItem[] }>(`/finance/payroll/periods${brandId ? `?brand_id=${brandId}` : ""}`, { token }),
  period: (token: string, id: string) =>
    api<{ period: PaymentPeriod; summary: PeriodSummary; hosts: HostPayRow[]; adjustments: HourAdjustment[]; slips: SalarySlipRow[] }>(
      `/finance/payroll/periods/${id}`,
      { token }
    ),
  addAdjustment: (token: string, periodId: string, data: { host_id: string; sessions_added: number; hours_added: number; notes: string }) =>
    post(`/finance/payroll/periods/${periodId}/adjustments`, token, data),
  removeAdjustment: (token: string, id: string) => api<Message>(`/finance/payroll/adjustments/${id}`, { method: "DELETE", token }),
  requestPayment: (token: string, periodId: string) => post(`/finance/payroll/periods/${periodId}/request`, token),
  markPaid: (token: string, periodId: string) => post(`/finance/payroll/periods/${periodId}/paid`, token),
  exportUrl: (token: string, periodId: string) => apiFileUrl(`/finance/payroll/periods/${periodId}/export`, token),
  slip: (token: string, id: string) => api<{ slip: SlipDetail }>(`/finance/payroll/slips/${id}`, { token }),
  advances: (token: string, status: "open" | "paid" | "" = "") =>
    api<{ advances: CashAdvance[] }>(`/finance/cash-advances${status ? `?status=${status}` : ""}`, { token }),
  createAdvance: (
    token: string,
    data: { host_id: string; type: CashAdvance["type"]; total_amount: number; installment_count: number; notes: string | null }
  ) => post("/finance/cash-advances", token, data),
  removeAdvance: (token: string, id: string) => api<Message>(`/finance/cash-advances/${id}`, { method: "DELETE", token }),
};

export interface MyPay {
  current: {
    period_id: string;
    brand: { id: string; name: string };
    period_start: string;
    period_end: string;
    status: PeriodStatus;
    session_count: number;
    hours: number;
    rate_per_hour: number;
    estimate: number;
  }[];
  slips: {
    id: string;
    brand: { id: string; name: string };
    period_start: string;
    period_end: string;
    gross_amount: number;
    advance_deduction: number;
    net_amount: number;
    generated_at: string;
  }[];
  advances: {
    id: string;
    type: CashAdvance["type"];
    total_amount: number;
    installment_count: number;
    status: CashAdvance["status"];
    notes: string | null;
    requested_at: string;
    remaining: number;
  }[];
}

export const payApi = {
  mine: (token: string) => api<MyPay>("/host/pay", { token }),
  slip: (token: string, id: string) => api<{ slip: SlipDetail }>(`/host/pay/slips/${id}`, { token }),
};

/*
|--------------------------------------------------------------------------
| Notifications & Discord
|--------------------------------------------------------------------------
*/
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** Frontend path to open, e.g. "/host/backups" */
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export const notificationApi = {
  list: (token: string) => api<{ notifications: AppNotification[]; unread: number }>("/notifications", { token }),
  unreadCount: (token: string) => api<{ unread: number }>("/notifications/unread-count", { token }),
  read: (token: string, id: string) => post(`/notifications/${id}/read`, token),
  readAll: (token: string) => post("/notifications/read-all", token),
};

export interface DiscordStatus {
  /** false when the server has no Discord bot / app configured */
  available: boolean;
  link: { discord_username: string | null; linked_at: string } | null;
}

export const discordApi = {
  status: (token: string) => api<DiscordStatus>("/discord", { token }),
  connectUrl: (token: string, state: string) => api<{ url: string }>(`/discord/connect-url?state=${encodeURIComponent(state)}`, { token }),
  link: (token: string, code: string) =>
    post<{ link: NonNullable<DiscordStatus["link"]> } & Message>("/discord/link", token, { code }),
  unlink: (token: string) => api<Message>("/discord/link", { method: "DELETE", token }),
  test: (token: string) => post("/discord/test", token),
};
