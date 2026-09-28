"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authApi, type AuthUser, type RoleName } from "@/lib/api";
import { clearSession, hasAnyRole, homePathFor, loadSession, saveSession } from "@/lib/auth";

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

/**
 * Renders children only for a signed-in, active user with one of `roles`.
 * Signed-out users go to /login; users with the wrong role go to their own home page.
 */
export function RequireAuth({ roles, children }: { roles: RoleName[]; children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<{ token: string; user: AuthUser } | null>(null);
  const rolesKey = roles.join("|");

  useEffect(() => {
    let cancelled = false;

    loadSession().then((result) => {
      if (cancelled) return;

      if (!result) {
        router.replace("/login");
      } else if (!hasAnyRole(result.user, rolesKey.split("|") as RoleName[])) {
        router.replace(homePathFor(result.user));
      } else {
        setSession(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router, rolesKey]);

  const setUser = useCallback((user: AuthUser) => {
    setSession((current) => {
      if (!current) return current;
      saveSession(current.token, user);
      return { ...current, user };
    });
  }, []);

  const logout = useCallback(async () => {
    if (session) {
      await authApi.logout(session.token).catch(() => {}); // token may already be revoked
    }
    clearSession();
    router.replace("/login");
  }, [router, session]);

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ ...session, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * For login/register pages: sends users who are already signed in to their home page.
 */
export function GuestOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    loadSession().then((result) => {
      if (result) router.replace(homePathFor(result.user));
    });
  }, [router]);

  return children;
}
