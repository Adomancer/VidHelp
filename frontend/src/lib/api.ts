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

/*
|--------------------------------------------------------------------------
| Auth API
|--------------------------------------------------------------------------
*/
export type UserStatus = "pending" | "active" | "inactive" | "archived";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  status: UserStatus;
  roles: { name: string }[];
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

export const authApi = {
  login: (email: string, password: string) =>
    api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (data: { name: string; email: string; password: string; password_confirmation: string }) =>
    api("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  logout: (token: string) =>
    api("/auth/logout", { method: "POST", token }),

  me: (token: string) =>
    api("/auth/me", { token }),

  googleRedirect: () =>
    api<{ url: string }>("/auth/google/redirect"),

  /** Exchange the authorization code Google redirected back with. */
  googleCallback: (code: string) =>
    api<AuthSession | PendingSignup>(`/auth/google/callback?code=${encodeURIComponent(code)}`),
};
