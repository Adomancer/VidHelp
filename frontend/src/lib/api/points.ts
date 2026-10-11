/** Points, warning letters (SP), ratings, and a host's own performance. */

import { api, downloadFile, type Message, post, put, query } from "./client";
import type { AuthUser } from "./auth";
import type { HostProfile } from "./hosts";

export interface ViolationType {
  id: string;
  name: string;
  code: string | null;
  default_points: number;
  rating_impact: number;
  is_active: boolean;
}

export interface PointLog {
  id: string;
  source: "internal" | "brand_complaint" | "backup_cancel" | "late_attachment";
  points_change: number;
  reason: string | null;
  occurred_on: string;
  voided_at?: string | null;
  violation_type: { id: string; name: string } | null;
  recorder?: { id: string; name: string } | null;
  brand_complaint?: { id: string; description: string; brand: { id: string; name: string } } | null;
}

export interface WarningLetter {
  id: string;
  level: 1 | 2 | 3;
  reason: string;
  issued_at: string;
  period_start: string;
  voided_at?: string | null;
  issuer?: { id: string; name: string } | null;
}

export interface HostRating {
  id: string;
  month_year: string;
  rating: number;
  suggested_rating?: number | null;
  note: string | null;
  rater?: { id: string; name: string } | null;
}

export interface PointsPeriod {
  start: string;
  end: string;
}

/** SP level → points threshold, e.g. { 1: 75, 2: 50, 3: 25 } */
export type SpThresholds = Record<string, number>;

export interface PointsHostRow {
  host_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  points: number;
  sp_level: number;
  deductions: number;
}

export interface PointsHostDetail {
  host: HostProfile & { user: AuthUser };
  period: PointsPeriod;
  points: number;
  opening_points: number;
  thresholds: SpThresholds;
  logs: PointLog[];
  warning_letters: WarningLetter[];
  ratings: HostRating[];
}

export interface RatingRow {
  host_id: string;
  name: string;
  avatar_url: string | null;
  violations: number;
  suggested: number;
  rating: HostRating | null;
}

export const pointsApi = {
  hosts: (token: string, search = "") =>
    api<{ period: PointsPeriod; thresholds: SpThresholds; hosts: PointsHostRow[] }>(`/operator/points${query({ search })}`, { token }),
  host: (token: string, hostId: string, on?: string) => api<PointsHostDetail>(`/operator/points/hosts/${hostId}${query({ on })}`, { token }),
  violationTypes: (token: string) => api<{ violation_types: ViolationType[] }>("/operator/violation-types", { token }),
  recordViolation: (token: string, data: { host_id: string; violation_type_id: string; points: number | null; reason: string | null; occurred_on: string }) =>
    post<{ points: number; warning_letter: WarningLetter | null } & Message>("/operator/points/violations", token, data),
  recordComplaint: (token: string, data: { host_id: string; brand_id: string; description: string; points: number | null; occurred_on: string }) =>
    post<{ points?: number; warning_letter?: WarningLetter | null } & Message>("/operator/points/complaints", token, data),

  // Admin only
  voidLog: (token: string, logId: string) => post<{ points: number } & Message>(`/admin/points/logs/${logId}/void`, token),
  issueWarning: (token: string, data: { host_id: string; level: number; reason: string }) =>
    post<{ warning_letter: WarningLetter } & Message>("/admin/warning-letters", token, data),
  voidWarning: (token: string, letterId: string) => post(`/admin/warning-letters/${letterId}/void`, token),
  allViolationTypes: (token: string) => api<{ violation_types: ViolationType[] }>("/admin/violation-types", { token }),
  createViolationType: (token: string, data: Pick<ViolationType, "name" | "default_points" | "rating_impact">) =>
    post<{ violation_type: ViolationType } & Message>("/admin/violation-types", token, data),
  updateViolationType: (token: string, id: string, data: Partial<Pick<ViolationType, "name" | "default_points" | "rating_impact" | "is_active">>) =>
    put<{ violation_type: ViolationType } & Message>(`/admin/violation-types/${id}`, token, data),
  ratings: (token: string, month: string) =>
    api<{ month: string; scale: { min: number; max: number }; hosts: RatingRow[] }>(`/admin/ratings${query({ month })}`, { token }),
  rate: (token: string, data: { host_id: string; month_year: string; rating: number; note: string | null }) =>
    put<{ rating: HostRating } & Message>("/admin/ratings", token, data),
  /** Ratings of the month, plus that month's point history and SP letters, as Excel. */
  exportRatings: (token: string, month: string) => downloadFile(`/admin/ratings/export${query({ month })}`, token, `ratings-${month}.xlsx`),
  /** A host's full point and SP history across all periods, newest first. */
  history: (token: string, hostId: string) => api<{ logs: PointLog[]; warning_letters: WarningLetter[] }>(`/admin/ratings/hosts/${hostId}/history`, { token }),
};

export interface Performance {
  period: PointsPeriod;
  points: number;
  opening_points: number;
  thresholds: SpThresholds;
  logs: PointLog[];
  warning_letters: WarningLetter[];
  ratings: HostRating[];
}

export const performanceApi = {
  mine: (token: string) => api<Performance>("/host/performance", { token }),
};
