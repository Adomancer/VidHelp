/** Backups: hosts asking for and covering sessions, and the operator's backup desk. */

import { api, apiFileUrl, type Message, post, query } from "./client";
import type { HostWithUser } from "./hosts";

/** open = no applicants yet · pending = applicants wait for the admin's decision */
export type BackupStatus = "pending" | "open" | "filled" | "cancelled" | "rejected";

export type BackupReason = "sick" | "permit" | "other";

/** open = every host may apply · direct = only the hosts the requester named */
export type BackupRequestType = "open" | "direct";

export type LetterStatus = "not_needed" | "uploaded" | "due" | "late";

export interface BackupRequest {
  id: string;
  slot_id: string;
  brand_id: string;
  requesting_host_id: string;
  backup_date: string;
  /** ISO datetimes */
  start_at: string;
  end_at: string;
  reason_type: BackupReason;
  reason: string | null;
  request_type: BackupRequestType;
  status: BackupStatus;
  /** When the cover was approved (by an admin, or automatically) */
  approved_at: string | null;
  auto_fill_at: string;
  auto_filled: boolean;
  counts_toward_quota: boolean;
  filled_by_host_id: string | null;
  letter_status: LetterStatus;
  letter_due_at: string | null;
  /**
   * Who pays the cover: the agency when the requester was sick and the letter came on time;
   * otherwise the requester, directly to the cover (outside payroll). null while a sick letter can still come.
   */
  cover_paid_by: "agency" | "requester" | null;
  brand: { id: string; name: string };
  requester?: HostWithUser;
  filler?: HostWithUser | null;
  attachments?: { id: string; original_name: string | null; created_at: string }[];
  /** Hosts named on a direct request */
  nominees?: { id: string; nominee_host_id: string; host: HostWithUser }[];
  applicants_count?: number;
}

/** What hosts see about someone else's request (no reason). */
export interface BackupNeed {
  id: string;
  brand: { id: string; name: string };
  requester_name: string;
  backup_date: string;
  start_at: string;
  end_at: string;
  status: BackupStatus;
  request_type: BackupRequestType;
  nominee_names: string[];
  /** The requester named me */
  asked_me?: boolean;
  same_brand?: boolean;
  my_application?: { id: string; status: "applied" | "approved" | "rejected" | "withdrawn" | "cancelled" } | null;
  ineligible_reason?: string | null;
}

export interface SlotOccurrence {
  slot_id: string;
  date: string;
  start_at: string;
  end_at: string;
  brand: { id: string; name: string };
}

export interface BackupQuota {
  month_year?: string;
  quota_used: number;
  quota_max: number;
}

export interface BackupCandidate {
  host_id: string;
  name: string;
  avatar_url: string | null;
  same_brand: boolean;
  rating?: number | null;
  eligible: boolean;
  ineligible_reason: string | null;
  quota: BackupQuota;
  applied_at?: string;
}

/** A host the requester may name (no rating or quota shown to other hosts). */
export type NomineeCandidate = Pick<BackupCandidate, "host_id" | "name" | "avatar_url" | "same_brand" | "eligible" | "ineligible_reason">;

/** A backup on one date of a weekly slot, for marking schedules. */
export interface SlotBackupMarker {
  id: string;
  slot_id: string;
  backup_date: string;
  status: "pending" | "open" | "filled";
  filler_name: string | null;
}

export interface BackupRequestInput {
  slot_id: string;
  backup_date: string;
  reason_type: BackupReason;
  reason: string | null;
}

/** A host's own request: open to all, or to named hosts, optionally with the sick letter. */
export interface HostBackupRequestInput extends BackupRequestInput {
  request_type: BackupRequestType;
  host_ids: string[];
  letter: File | null;
}

export const hostBackupApi = {
  mine: (token: string) => api<{ requests: BackupRequest[]; covers: BackupNeed[]; quota: BackupQuota }>("/host/backups", { token }),
  needs: (token: string) => api<{ needs: BackupNeed[] }>("/host/backups/needs", { token }),
  slots: (token: string) => api<{ slots: SlotOccurrence[] }>("/host/backups/slots", { token }),
  /** Hosts I could name for a direct request on one of my sessions. */
  candidates: (token: string, slotId: string, date: string) =>
    api<{ candidates: NomineeCandidate[] }>(`/host/backups/candidates${query({ slot_id: slotId, backup_date: date })}`, { token }),
  request: (token: string, data: HostBackupRequestInput) => {
    const body = new FormData();
    body.append("slot_id", data.slot_id);
    body.append("backup_date", data.backup_date);
    body.append("reason_type", data.reason_type);
    if (data.reason) body.append("reason", data.reason);
    body.append("request_type", data.request_type);
    if (data.request_type === "direct") data.host_ids.forEach((id) => body.append("host_ids[]", id));
    if (data.letter) body.append("letter", data.letter);
    return post<{ request: BackupRequest } & Message>("/host/backups", token, body);
  },
  cancel: (token: string, id: string) => post(`/host/backups/${id}/cancel`, token),
  uploadLetter: (token: string, id: string, letter: File) => {
    const body = new FormData();
    body.append("letter", letter);
    return post<{ request: BackupRequest } & Message>(`/host/backups/${id}/letter`, token, body);
  },
  apply: (token: string, id: string) => post(`/host/backups/${id}/apply`, token),
  withdraw: (token: string, id: string) => post(`/host/backups/${id}/withdraw`, token),
  /** Drop a backup you were picked for (point penalty). */
  drop: (token: string, id: string) => post(`/host/backups/${id}/drop`, token),
};

/** How the latest closed requests went (the "Ringkasan riwayat" card). */
export interface BackupRecap {
  /** Requests counted: the latest `window` closed ones, or fewer. */
  total: number;
  window: number;
  filled: number;
  auto_filled: number;
  top_covers: { name: string; avatar_url: string | null; count: number }[];
}

export const operatorBackupApi = {
  /** An upcoming tab, whole (up to 100), with its `total`. */
  list: (token: string, status: "pending" | "open" | "filled") =>
    api<{ requests: BackupRequest[]; total: number }>(`/operator/backups${query({ status })}`, { token }),
  /** Past, cancelled and rejected requests: 25 a page, searched on the server. */
  closed: (token: string, params: { page: number; search?: string; reason_types?: BackupReason[] }) =>
    api<{ requests: BackupRequest[]; total: number; current_page: number; last_page: number }>(
      `/operator/backups${query({ status: "closed", ...params })}`,
      { token }
    ),
  /** Sick requests still missing their doctor's letter, on any tab and however old. */
  letters: (token: string) => api<{ requests: BackupRequest[]; total: number }>("/operator/backups/letters", { token }),
  recap: (token: string) => api<BackupRecap>("/operator/backups/recap", { token }),
  /** With `host_id`, that host covers it right away. */
  create: (token: string, data: BackupRequestInput & { host_id?: string | null }) =>
    post<{ request: BackupRequest } & Message>("/operator/backups", token, data),
  /** Who could cover one session of a slot, before a request exists (free hosts first). */
  slotCandidates: (token: string, slotId: string, date: string) =>
    api<{ candidates: BackupCandidate[] }>(`/operator/backups/candidates${query({ slot_id: slotId, backup_date: date })}`, { token }),
  applicants: (token: string, id: string) => api<{ applicants: BackupCandidate[] }>(`/operator/backups/${id}/applicants`, { token }),
  candidates: (token: string, id: string) => api<{ candidates: BackupCandidate[] }>(`/operator/backups/${id}/candidates`, { token }),
  /** Turn an applicant down; with nobody else waiting, the request is open again. */
  rejectApplicant: (token: string, id: string, hostId: string) => post(`/operator/backups/${id}/reject-applicant`, token, { host_id: hostId }),
  cancel: (token: string, id: string) => post(`/operator/backups/${id}/cancel`, token),
  /** Approve (ACC) a cover: an applicant, or any free host in an emergency. */
  assign: (token: string, id: string, hostId: string) => post(`/operator/backups/${id}/assign`, token, { host_id: hostId }),
  unassign: (token: string, id: string) => post(`/operator/backups/${id}/unassign`, token),
  letterUrl: (token: string, id: string) => apiFileUrl(`/operator/backups/${id}/letter`, token),
};
