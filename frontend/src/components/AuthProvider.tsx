"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { authApi, onSessionProblem, type AuthUser, type RoleName } from "@/lib/api";
import { clearSession, hasAnyRole, homePathFor, loadSession, onTokenChangedElsewhere, saveSession, TWO_FACTOR_SETUP_PATH } from "@/lib/auth";
import ErrorState from "./ErrorState";
import { notify } from "./Toast";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  /** The server couldn't be asked (offline, 5xx): the stored token is kept for a retry. */
  | { status: "unreachable" }
  | { status: "signed-in"; token: string; user: AuthUser };

interface SessionContextValue {
  state: SessionState;
  /** Remember a fresh token (after login, 2FA or Google) and its user. */
  signIn: (token: string, user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
  /** Ask the server again after "unreachable". */
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <AuthSessionProvider>");
  return context;
}

/** Sign-in for login, 2FA and Google callback forms. */
export function useSignIn() {
  return useSession().signIn;
}

/**
 * Who is signed in, checked with the server once per page load (in the root layout), so moving
 * between areas (admin, host app, Discord callback) doesn't ask again or flash a loader.
 *
 * It also ends the session when it dies while the page is open: a request answered 401/403 by the auth
 * middleware (password reset, account deactivated, signed out elsewhere) or another tab signing out.
 * Another tab signing in as someone else reloads this one, so nothing is done in the old account's name.
 */
export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: "loading" });
  /** The token the shared data cache was filled for; another account starts with an empty cache. */
  const cacheToken = useRef<string | null>(null);

  const signIn = useCallback(
    (token: string, user: AuthUser) => {
      saveSession(token);
      if (cacheToken.current !== token) {
        queryClient.clear();
        cacheToken.current = token;
      }
      setState({ status: "signed-in", token, user });
    },
    [queryClient]
  );

  const check = useCallback(() => {
    loadSession().then((result) => {
      if (result === "unreachable") setState({ status: "unreachable" });
      else if (result) signIn(result.token, result.user);
      else setState({ status: "signed-out" });
    });
  }, [signIn]);

  useEffect(check, [check]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    check();
  }, [check]);

  const end = useCallback(
    (message?: string) => {
      clearSession();
      queryClient.clear();
      cacheToken.current = null;
      setState({ status: "signed-out" });
      if (message) notify({ text: message, tone: "error" });
      router.replace("/login");
    },
    [router, queryClient]
  );

  const token = state.status === "signed-in" ? state.token : null;

  useEffect(() => {
    if (!token) return;

    const stopProblems = onSessionProblem((problem) => {
      if (problem.token !== token) return; // a late answer for an earlier session
      if (problem.reason === "two-factor") {
        // An admin reset this admin's 2FA: RequireAuth sends them to set it up again
        setState((current) => (current.status === "signed-in" ? { ...current, user: { ...current.user, two_factor_setup_required: true } } : current));
        return;
      }
      end(problem.message || "Sesi kamu sudah berakhir. Silakan masuk lagi.");
    });
    const stopTabs = onTokenChangedElsewhere((newToken) => {
      if (newToken === token) return;
      if (newToken)
        window.location.reload(); // someone else signed in on this browser
      else end("Kamu sudah keluar di tab lain.");
    });

    return () => {
      stopProblems();
      stopTabs();
    };
  }, [token, end]);

  // Signed in from another tab while this one shows the login page
  useEffect(() => {
    if (state.status !== "signed-out") return;
    return onTokenChangedElsewhere((newToken) => {
      if (newToken) window.location.reload();
    });
  }, [state.status]);

  const setUser = useCallback((user: AuthUser) => {
    setState((current) => (current.status === "signed-in" ? { ...current, user } : current));
  }, []);

  const logout = useCallback(async () => {
    if (token) await authApi.logout(token).catch(() => {}); // token may already be revoked
    end();
  }, [token, end]);

  const value = useMemo(() => ({ state, signIn, setUser, logout, retry }), [state, signIn, setUser, logout, retry]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

interface AuthContextValue {
  user: AuthUser;
  token: string;
  /** Replace the cached user after a profile change. */
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** The signed-in user. Only usable inside <RequireAuth>. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <RequireAuth>");
  return context;
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background" aria-busy="true">
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-xs">V</span>
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Memuat" />
    </div>
  );
}

/**
 * Renders children only for a signed-in, active user with one of `roles`.
 * Signed-out users go to /login; users with the wrong role go to their own home page;
 * admins who must still set up 2FA go to the setup page (unless this is that page).
 */
export function RequireAuth({ roles, allowTwoFactorSetup = false, children }: { roles: RoleName[]; allowTwoFactorSetup?: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const { state, setUser, logout, retry } = useSession();
  const rolesKey = roles.join("|");
  const user = state.status === "signed-in" ? state.user : null;
  const roleAllowed = user !== null && hasAnyRole(user, rolesKey.split("|") as RoleName[]);
  const mustSetUpTwoFactor = user !== null && user.two_factor_setup_required && !allowTwoFactorSetup;

  useEffect(() => {
    if (state.status === "signed-out") router.replace("/login");
    else if (user && !roleAllowed) router.replace(homePathFor(user));
    else if (mustSetUpTwoFactor) router.replace(TWO_FACTOR_SETUP_PATH);
  }, [router, state.status, user, roleAllowed, mustSetUpTwoFactor]);

  const token = state.status === "signed-in" ? state.token : null;
  const value = useMemo(() => (token && user ? { token, user, setUser, logout } : null), [token, user, setUser, logout]);

  if (state.status === "unreachable") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <ErrorState className="max-w-md" message="Tidak bisa terhubung ke server. Periksa koneksi internet kamu lalu coba lagi." onRetry={retry} />
      </div>
    );
  }

  if (!value || !roleAllowed || mustSetUpTwoFactor) return <FullScreenLoader />;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * For login/register pages: sends users who are already signed in to their home page.
 * Shows nothing until that is known, so the form doesn't flash for them.
 */
export function GuestOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { state } = useSession();
  const home = state.status === "signed-in" ? homePathFor(state.user) : null;

  useEffect(() => {
    if (home) router.replace(home);
  }, [router, home]);

  if (state.status === "loading" || home) return null;
  return children;
}
