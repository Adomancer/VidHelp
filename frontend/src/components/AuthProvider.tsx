"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { authApi, type AuthUser, type RoleName } from "@/lib/api";
import { clearSession, hasAnyRole, homePathFor, loadSession, saveSession, TWO_FACTOR_SETUP_PATH } from "@/lib/auth";

interface AuthContextValue {
  user: AuthUser;
  token: string;
  /** Replace the cached user after a profile change. */
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** The token the shared data cache was filled for; another account starts with an empty cache. */
let cacheToken: string | null = null;

/** The signed-in user. Only usable inside <RequireAuth>. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <RequireAuth>");
  return context;
}

/**
 * Renders children only for a signed-in, active user with one of `roles`.
 * Signed-out users go to /login; users with the wrong role go to their own home page;
 * admins who must still set up 2FA go to the setup page (unless this is that page).
 */
export function RequireAuth({
  roles,
  allowTwoFactorSetup = false,
  children,
}: {
  roles: RoleName[];
  allowTwoFactorSetup?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
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
      } else if (result.user.two_factor_setup_required && !allowTwoFactorSetup) {
        router.replace(TWO_FACTOR_SETUP_PATH);
      } else {
        if (cacheToken !== result.token) {
          queryClient.clear();
          cacheToken = result.token;
        }
        setSession(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router, queryClient, rolesKey, allowTwoFactorSetup]);

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
    queryClient.clear();
    cacheToken = null;
    router.replace("/login");
  }, [router, queryClient, session]);

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background" aria-busy="true">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-xs">V</span>
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Memuat" />
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
