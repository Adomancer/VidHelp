import type { AuthUser } from "./api";

const TOKEN_KEY = "vidhelp_token";
const USER_KEY = "vidhelp_user";
const OAUTH_STATE_KEY = "vidhelp_google_state";

/*
|--------------------------------------------------------------------------
| Session (browser only)
|--------------------------------------------------------------------------
*/
export function saveSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Landing page for a user, based on their highest role. */
export function homePathFor(user: AuthUser): string {
  const roles = user.roles.map((role) => role.name);

  if (roles.includes("admin")) return "/admin/dashboard";
  if (roles.includes("operator")) return "/operator/dashboard";
  return "/host/schedule";
}

/*
|--------------------------------------------------------------------------
| Google OAuth state (CSRF protection for the redirect round-trip)
|--------------------------------------------------------------------------
*/
export function createOAuthState(): string {
  const state = crypto.randomUUID();
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  return state;
}

/** True if `state` matches the one we created before leaving for Google. Single use. */
export function consumeOAuthState(state: string | null): boolean {
  const expected = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  return expected !== null && expected === state;
}
