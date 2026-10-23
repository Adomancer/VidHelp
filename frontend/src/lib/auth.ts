import { ApiError, authApi, type AuthUser, type RoleName } from "./api";

const TOKEN_KEY = "vidhelp_token";
/** Older versions also kept the user here; it was never read back. Removed on the next visit. */
const LEGACY_USER_KEY = "vidhelp_user";
const OAUTH_STATE_KEY = "vidhelp_google_state";

/*
|--------------------------------------------------------------------------
| Session (browser only)
|--------------------------------------------------------------------------
*/
export function saveSession(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_USER_KEY);
}

/**
 * Check the stored token with the backend. Returns null (and forgets the token) if it is missing,
 * expired, revoked, or the account is no longer active; "unreachable" if the server couldn't answer
 * (offline, 5xx): the token may still be fine, so it is kept.
 */
export async function loadSession(): Promise<{ token: string; user: AuthUser } | null | "unreachable"> {
  localStorage.removeItem(LEGACY_USER_KEY);
  const token = getToken();
  if (!token) return null;

  try {
    const { user } = await authApi.me(token);
    return { token, user };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      clearSession();
      return null;
    }
    return "unreachable";
  }
}

/**
 * Be told when another tab signs in or out (the token in localStorage changes). Returns the unsubscribe.
 * `token` is the new one, or null after signing out.
 */
export function onTokenChangedElsewhere(listener: (token: string | null) => void): () => void {
  const handle = (event: StorageEvent) => {
    if (event.key === TOKEN_KEY || event.key === null) listener(getToken());
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}

export function hasAnyRole(user: AuthUser, roles: RoleName[]): boolean {
  return user.roles.some((role) => roles.includes(role.name));
}

export const TWO_FACTOR_SETUP_PATH = "/two-factor/setup";

/**
 * Landing page for a user, based on their highest role (admins without required 2FA set it up first).
 * Finance works in the admin panel: it has every admin right, plus changing payroll and kasbon.
 */
export function homePathFor(user: AuthUser): string {
  if (user.two_factor_setup_required) return TWO_FACTOR_SETUP_PATH;
  if (hasAnyRole(user, ["admin", "finance"])) return "/admin/dashboard";
  if (hasAnyRole(user, ["operator"])) return "/operator/dashboard";
  return "/host/dashboard";
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
