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

export type RoleName = "admin" | "operator" | "host";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  avatar_url: string | null;
  status: UserStatus;
  signup_source: "admin_created" | "self_register";
  has_password: boolean;
  approved_at: string | null;
  last_login_at: string | null;
  created_at: string;
  roles: { name: RoleName }[];
}

/** Returned when login succeeds. */
export interface AuthSession {
  user: AuthUser;
  token: string;
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
    api<AuthSession>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
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
    api<AuthSession | PendingSignup>(`/auth/google/callback?code=${encodeURIComponent(code)}`),
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

export const adminApi = {
  users: (token: string, params: { status?: UserStatus; search?: string; page?: number }) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.search) query.set("search", params.search);
    query.set("page", String(params.page ?? 1));

    return api<Paginated<AuthUser>>(`/admin/users?${query}`, { token });
  },

  activateUser: (token: string, id: string) =>
    api<Message>(`/admin/users/${id}/activate`, { method: "POST", token }),

  deactivateUser: (token: string, id: string) =>
    api<Message>(`/admin/users/${id}/deactivate`, { method: "POST", token }),

  setRole: (token: string, id: string, role: RoleName) =>
    api<{ user: AuthUser }>(`/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify({ role }),
      token,
    }),
};

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

export type AdminHostInput = Partial<Pick<HostProfile, "phone" | "guardian_phone" | "join_date" | "status" | "rate_category_id">>;

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
    return api<{ slots: ScheduleSlot[]; backups: SlotBackupMarker[] }>(`/operator/schedules?${query}`, { token });
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
    api<{ slots: ScheduleSlot[]; upcoming: ScheduleSlot[]; covers: BackupNeed[]; absences: SlotBackupMarker[] }>("/host/schedules", { token }),

  myAvailability: (token: string) => api<{ availability: AvailabilityRange[] }>("/host/availability", { token }),

  saveAvailability: (token: string, ranges: AvailabilityRange[]) =>
    api<{ availability: AvailabilityRange[] } & Message>("/host/availability", { method: "PUT", body: JSON.stringify({ ranges }), token }),
};

/*
|--------------------------------------------------------------------------
| Backups
|--------------------------------------------------------------------------
*/
export type BackupStatus = "pending" | "open" | "filled" | "cancelled" | "rejected";
export type BackupReason = "sick" | "permit" | "other";
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
  status: BackupStatus;
  approved_at: string | null;
  auto_approved: boolean;
  auto_open_at: string | null;
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
  eligible: boolean;
  ineligible_reason: string | null;
  quota: BackupQuota;
  applied_at?: string;
}

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

const post = <T = Message>(endpoint: string, token: string, body?: unknown) =>
  api<T>(endpoint, { method: "POST", token, body: body === undefined ? undefined : JSON.stringify(body) });

export const hostBackupApi = {
  mine: (token: string) =>
    api<{ requests: BackupRequest[]; covers: BackupNeed[]; quota: BackupQuota }>("/host/backups", { token }),
  needs: (token: string) => api<{ needs: BackupNeed[] }>("/host/backups/needs", { token }),
  slots: (token: string) => api<{ slots: SlotOccurrence[] }>("/host/backups/slots", { token }),
  request: (token: string, data: BackupRequestInput) => post<{ request: BackupRequest } & Message>("/host/backups", token, data),
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
  approve: (token: string, id: string) => post(`/operator/backups/${id}/approve`, token),
  reject: (token: string, id: string) => post(`/operator/backups/${id}/reject`, token),
  cancel: (token: string, id: string) => post(`/operator/backups/${id}/cancel`, token),
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
  slot_id: string;
  backup_request_id: string | null;
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
  slot_id: string;
  date: string;
  backup_request_id: string | null;
  brand: { id: string; name: string };
  start_at: string;
  end_at: string;
  /** own = my slot, off = someone covers me, cover = I cover someone */
  role: "own" | "off" | "cover";
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
  checkIn: (token: string, session: Pick<LiveSession, "slot_id" | "date" | "backup_request_id">) =>
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
