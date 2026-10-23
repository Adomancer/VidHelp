"use client";

import { hasAnyRole } from "@/lib/auth";
import { useAuth } from "../AuthProvider";

export type Confirm = { title: string; body: string; label: string; destructive?: boolean; run: () => Promise<{ message: string }> } | null;

/** Only finance changes payroll and kasbon; admins see everything but can't change it. */
export function useCanManageFinance(): boolean {
  const { user } = useAuth();
  return hasAnyRole(user, ["finance"]);
}

/** "hari ini", "1 hari", "12 hari" since a moment. */
export function daysSince(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return days < 1 ? "hari ini" : `${days} hari`;
}
