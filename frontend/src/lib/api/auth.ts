/** Signing in and out, sign-up, passwords, Google, and admins' two-factor authentication. */

import { api, type Message, post, del, query } from "./client";

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

  logout: (token: string) => post("/auth/logout", token),

  me: (token: string) => api<{ user: AuthUser }>("/auth/me", { token }),

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
    post("/host/profile/password", token, data),

  googleRedirect: () => api<{ url: string }>("/auth/google/redirect"),

  /** Exchange the authorization code Google redirected back with. */
  googleCallback: (code: string) => api<AuthSession | PendingSignup | TwoFactorChallenge>(`/auth/google/callback${query({ code })}`),
};

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
  setup: (token: string) => post<{ secret: string; otpauth_url: string }>("/two-factor/setup", token),

  confirm: (token: string, code: string) => post<Message & { recovery_codes: string[]; user: AuthUser }>("/two-factor/confirm", token, { code }),

  regenerateRecoveryCodes: (token: string, code: string) => post<Message & { recovery_codes: string[] }>("/two-factor/recovery-codes", token, { code }),

  disable: (token: string, code: string) => del("/two-factor", token, { code }),
};
