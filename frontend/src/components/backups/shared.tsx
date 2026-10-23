"use client";

import { type BackupRequest } from "@/lib/api";

export type Tab = "pending" | "open" | "filled" | "closed";

export const hoursOf = (backup: BackupRequest) => (new Date(backup.end_at).getTime() - new Date(backup.start_at).getTime()) / 3_600_000;

export type Act = (action: () => Promise<{ message: string }>) => Promise<void>;
export type Confirm = { title: string; body: string; label: string; run: () => Promise<{ message: string }> } | null;
