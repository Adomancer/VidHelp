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
