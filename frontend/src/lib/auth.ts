import { ApiError, authApi, type AuthUser, type RoleName } from "./api";

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

/**
 * Check the stored token with the backend. Returns null (and forgets the token)
 * if it is missing, expired, revoked, or the account is no longer active.
 */
export async function loadSession(): Promise<{ token: string; user: AuthUser } | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const { user } = await authApi.me(token);
    saveSession(token, user);
    return { token, user };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      clearSession();
    }
    return null;
  }
}

export function hasAnyRole(user: AuthUser, roles: RoleName[]): boolean {
  return user.roles.some((role) => roles.includes(role.name));
}

/** Landing page for a user, based on their highest role. */
export function homePathFor(user: AuthUser): string {
  if (hasAnyRole(user, ["admin"])) return "/admin/dashboard";
  if (hasAnyRole(user, ["operator"])) return "/operator/dashboard";
  return "/host/live";
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
