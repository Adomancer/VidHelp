/** Check-in/out, live reports, and reviewing them. */

import type { PublicSettings } from "./admin";
import { api, type Message, type Paginated, post, query } from "./client";
import type { HostWithUser } from "./hosts";

/** When check-in opens for a session starting at `start` (an admin setting), or null until the settings have loaded. */
export function checkInOpensAt(start: Date, settings: PublicSettings | undefined): Date | null {
  const minutes = settings?.["attendance.check_in_opens_minutes"];
  return minutes === undefined ? null : new Date(start.getTime() - minutes * 60_000);
}

export type ReportStatus = "submitted" | "flagged" | "approved" | "rejected";

export interface LiveReport {
  id: string;
  attendance_id: string;
  session_count: number;
  duration_hours: number;
  metrics: Record<string, number> | null;
  notes: string | null;
  status: ReportStatus;
  flag_reasons: string[] | null;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface Attendance {
  id: string;
  /** null for event blocks */
  slot_id: string | null;
  backup_request_id: string | null;
  event_claim_id?: string | null;
  session_date: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  check_in_at: string;
  check_out_at: string | null;
  report_due_at: string;
  /** Minutes the check-in came after the start when that counts as late; 0 = on time. */
  late_minutes: number;
  report?: LiveReport | null;
  brand?: { id: string; name: string };
  host?: HostWithUser;
}

/** One session occurrence on the host's Live page. */
export interface LiveSession {
  /** null for event blocks */
  slot_id: string | null;
  date: string;
  backup_request_id: string | null;
  event_claim_id?: string | null;
  event_name?: string;
  brand: { id: string; name: string };
  start_at: string;
  end_at: string;
  /** own = my slot, off = someone covers me, cover = I cover someone, event = a claimed event block */
  role: "own" | "off" | "cover" | "event";
  covered_by?: string | null;
  covered_for?: string;
  attendance: Attendance | null;
}

export interface ReportInput {
  session_count: number;
  duration_hours: number;
  metrics: Record<string, number | null>;
  notes: string | null;
}

export interface ReviewReport extends LiveReport {
  brand: { id: string; name: string };
  host: HostWithUser;
  attendance: Attendance;
  reviewer: { id: string; name: string } | null;
  scheduled_hours: number;
  attended_hours: number | null;
}

export const liveApi = {
  today: (token: string) => api<{ sessions: LiveSession[]; missing_reports: Attendance[]; metrics: string[] }>("/host/live", { token }),
  checkIn: (token: string, { slot_id, date, backup_request_id, event_claim_id }: Pick<LiveSession, "slot_id" | "date" | "backup_request_id" | "event_claim_id">) =>
    post<{ attendance: Attendance } & Message>("/host/live/check-in", token, { slot_id, date, backup_request_id, event_claim_id }),
  checkOut: (token: string, attendanceId: string) => post<{ attendance: Attendance } & Message>(`/host/live/${attendanceId}/check-out`, token),
  report: (token: string, attendanceId: string, data: ReportInput) => post<{ report: LiveReport } & Message>(`/host/live/${attendanceId}/report`, token, data),
};

/** One session day ("YYYY-MM-DD") and/or a host or brand name; 30 a page. */
export interface ReportFilters {
  date?: string;
  search?: string;
  page?: number;
}

/** How many wait in each queue, whatever the filters (for the tab badges). */
export interface ReportCounts {
  flagged: number;
  missing: number;
}

export const reportApi = {
  /** Flagged: oldest first (a queue); approved and rejected: newest first. */
  list: (token: string, status: "flagged" | "approved" | "rejected", filters: ReportFilters = {}) =>
    api<Paginated<ReviewReport> & { metrics: string[]; counts: ReportCounts }>(`/operator/reports${query({ status, ...filters })}`, { token }),
  /** Check-ins whose report is overdue, newest first. */
  missing: (token: string, filters: ReportFilters = {}) =>
    api<Paginated<Attendance> & { counts: ReportCounts }>(`/operator/reports${query({ status: "missing", ...filters })}`, { token }),
  approve: (token: string, id: string, data: { duration_hours: number; review_note: string | null }) => post(`/operator/reports/${id}/approve`, token, data),
  reject: (token: string, id: string, reviewNote: string) => post(`/operator/reports/${id}/reject`, token, { review_note: reviewNote }),
};
