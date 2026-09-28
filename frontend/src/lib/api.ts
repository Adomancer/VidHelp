const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface FetchOptions extends RequestInit {
  token?: string;
}

/**
 * Base API client for communicating with the Laravel backend.
 * Handles auth token injection and JSON parsing.
 */
export async function api<T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { token, headers, ...rest } = options;

  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

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

  return response.json();
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
