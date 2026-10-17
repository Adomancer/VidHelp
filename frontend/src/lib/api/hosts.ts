/** Hosts, brands and rate levels: a host's own profile, the operator's host list, and admin edits. */

import { toDateInput } from "../format";
import { api, apiFileUrl, downloadFile, type Message, type Paginated, post, put, del, query } from "./client";
import type { AuthUser } from "./auth";

export type HostStatus = "active" | "inactive" | "archived" | "banned";

export type AssignmentStatus = "active" | "inactive" | "banned";

export interface RateCategory {
  id: string;
  name: string;
  min_tenure_months: number;
  rate_per_hour: string;
}

export type RateCategoryInput = Pick<RateCategory, "name" | "min_tenure_months"> & { rate_per_hour: number };

/** A host whose tenure reaches a higher level soon (the nightly re-placement moves them that day). */
export interface RatePromotion {
  host_id: string;
  name: string;
  avatar_url: string | null;
  /** "YYYY-MM-DD" */
  on: string;
  from: Pick<RateCategory, "id" | "name" | "rate_per_hour"> | null;
  to: Pick<RateCategory, "id" | "name" | "rate_per_hour">;
}

/** A host whose level an admin set by hand. */
export interface PinnedRateHost {
  host_id: string;
  name: string;
  avatar_url: string | null;
  level: Pick<RateCategory, "id" | "name"> | null;
}

export interface Brand {
  id: string;
  name: string;
  is_obs: boolean;
  /** What hosts assigned to the brand need to know (products, prices, talking points), as safe HTML */
  product_knowledge?: string | null;
  /** A pay period runs until this many hours are reached; the brand's leader then requests payment */
  target_hours_per_period: number;
  /** First day of the first payment period; each next one starts the day after the last one ended */
  payroll_start_date?: string | null;
  status: "active" | "inactive";
}

/** Product knowledge is edited on its own (text and files), not in the brand form. */
export type BrandInput = Omit<Brand, "id" | "product_knowledge">;

/** A file of a brand's product knowledge, as the brand sent it (PDF, screenshot, Office doc). */
export interface KnowledgeFile {
  id: string;
  original_name: string;
  mime_type: string;
  size_kb: number;
  created_at: string;
}

export interface BrandSummary extends Brand {
  active_hosts_count: number;
  created_at?: string;
  leader: { id: string; name: string } | null;
}

export interface Assignment {
  id: string;
  host_id: string;
  brand_id: string;
  is_leader: boolean;
  status: AssignmentStatus;
  brand: Pick<Brand, "id" | "name"> & Partial<Brand>;
}

/** What hosts (and admins) see: numbers masked. */
export interface SensitiveDataMasked {
  bank_name: string | null;
  account_holder_name: string | null;
  ktp_number_masked: string | null;
  bank_account_masked: string | null;
}

export interface HostProfile {
  id: string;
  user_id: string;
  rate_category_id: string | null;
  rate_category_overridden: boolean;
  phone: string | null;
  guardian_phone: string | null;
  join_date: string;
  status: HostStatus;
  updated_at: string;
  rate_category: RateCategory | null;
}

/** A host profile with its account. */
export type HostWithUser = HostProfile & { user: AuthUser };

/** One field of a personal data change: its new value (KTP/bank masked for the host) and, for admins, the saved one. */
export interface ProfileChangeField {
  field: "name" | "phone" | "guardian_phone" | "ktp_number" | "bank_name" | "bank_account" | "account_holder_name";
  label: string;
  value: string | null;
  current?: string | null;
}

export type ProfileChangeStatus = "pending" | "approved" | "rejected" | "cancelled";

/** The host's latest change request: waiting for an admin, or how it was decided. */
export interface MyProfileChange {
  id: string;
  status: ProfileChangeStatus;
  fields: ProfileChangeField[];
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface MyProfile {
  user: AuthUser;
  host_profile: (HostProfile & { sensitive_data: SensitiveDataMasked | null; assignments: Assignment[] }) | null;
  /** Personal data changes wait for an admin's approval. */
  profile_change?: MyProfileChange | null;
}

/** For admins: a host's change with the saved values next to the new ones (full numbers). */
export interface ProfileChangeRequest {
  id: string;
  status: ProfileChangeStatus;
  host: { id: string; name: string; email: string; avatar_url: string | null };
  fields: ProfileChangeField[];
  created_at: string;
  reviewed_at: string | null;
  reviewer: string | null;
  review_note: string | null;
}

export interface HostListItem extends HostProfile {
  user: AuthUser;
  assignments: Assignment[];
}

export interface AdminHostDetail extends HostListItem {
  sensitive_data: (SensitiveDataMasked & { ktp_number: string | null; bank_account: string | null }) | null;
}

/** Host status follows the account's (Users page), so it isn't set here. */
export type AdminHostInput = Partial<Pick<HostProfile, "phone" | "guardian_phone" | "join_date" | "rate_category_id">>;

export const hostApi = {
  profile: (token: string) => api<MyProfile>("/host/profile", { token }),

  updateProfile: (token: string, data: { name?: string; phone?: string | null; guardian_phone?: string | null }) =>
    put<MyProfile & Message>("/host/profile", token, data),

  uploadPhoto: (token: string, photo: File) => {
    const body = new FormData();
    body.append("photo", photo);
    return post<MyProfile & Message>("/host/profile/photo", token, body);
  },

  updateSensitive: (token: string, data: { ktp_number?: string; bank_name?: string; bank_account?: string; account_holder_name?: string }) =>
    put<MyProfile & Message>("/host/profile/sensitive", token, data),

  /** Take back my change request while it waits. */
  cancelChange: (token: string, id: string) => post<MyProfile & Message>(`/host/profile/changes/${id}/cancel`, token),

  /** Brands I'm actively assigned to, then the ones I cover a backup or an event block for soon, with their product knowledge. */
  brands: (token: string) => api<{ brands: MyBrand[] }>("/host/brands", { token }),

  /** One brand's product knowledge (one I'm assigned to, or cover a backup or event block for). */
  brand: (token: string, id: string) => api<{ brand: Omit<MyBrand, "via"> }>(`/host/brands/${id}`, { token }),

  /** One of its product knowledge files, as an object URL. */
  knowledgeFileUrl: (token: string, brandId: string, fileId: string) => apiFileUrl(`/host/brands/${brandId}/files/${fileId}`, token),
};

export type MyBrand = Pick<Brand, "id" | "name" | "is_obs"> & {
  product_knowledge: string | null;
  files: KnowledgeFile[];
  /** Why I see it: assigned to it, or going live for it as a backup or in an event block */
  via: "assigned" | "backup" | "event";
};

export interface HostFilters {
  search?: string[];
  host_ids?: string[];
  brand_id?: string;
}

export const operatorApi = {
  /** Hosts matching any of the `search` texts or `host_ids` (none = everyone), within the brand. */
  hosts: (token: string, params: HostFilters & { page?: number }) =>
    api<Paginated<HostListItem>>(`/operator/hosts${query({ ...params, page: params.page ?? 1 })}`, { token }),

  /** Every host matching the filters (not just one page) as an Excel file. */
  exportHosts: (token: string, params: HostFilters) => downloadFile(`/operator/hosts/export${query(params)}`, token, `hosts-${toDateInput()}.xlsx`),

  brands: (token: string) => api<{ brands: BrandSummary[] }>("/operator/brands", { token }),

  assign: (token: string, data: { host_id: string; brand_id: string; is_leader?: boolean }) =>
    post<{ assignment: Assignment }>("/operator/assignments", token, data),

  updateAssignment: (token: string, id: string, data: { is_leader?: boolean; status?: AssignmentStatus }) =>
    put<{ assignment: Assignment }>(`/operator/assignments/${id}`, token, data),
};

/** A brand's product knowledge: the text (often pasted from WA) and the files the brand sent. */
export const knowledgeApi = {
  get: (token: string, brandId: string) =>
    api<{ brand: Pick<Brand, "id" | "name"> & { product_knowledge: string | null }; files: KnowledgeFile[] }>(`/operator/brands/${brandId}/knowledge`, {
      token,
    }),

  saveText: (token: string, brandId: string, text: string | null) =>
    put<{ brand: { product_knowledge: string | null } } & Message>(`/operator/brands/${brandId}/knowledge`, token, { product_knowledge: text }),

  upload: (token: string, brandId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return post<{ file: KnowledgeFile } & Message>(`/operator/brands/${brandId}/knowledge/files`, token, body);
  },

  remove: (token: string, brandId: string, fileId: string) => del<Message>(`/operator/brands/${brandId}/knowledge/files/${fileId}`, token),

  fileUrl: (token: string, brandId: string, fileId: string) => apiFileUrl(`/operator/brands/${brandId}/knowledge/files/${fileId}`, token),
};

export const adminHostsApi = {
  /** Levels by tenure; plus who moves up within `upcoming_days` and who is placed by hand. */
  rateCategories: (token: string) =>
    api<{ rate_categories: (RateCategory & { hosts_count: number })[]; upcoming: RatePromotion[]; upcoming_days: number; pinned: PinnedRateHost[] }>(
      "/admin/rate-categories",
      { token }
    ),

  createRateCategory: (token: string, data: RateCategoryInput) => post<{ rate_category: RateCategory }>("/admin/rate-categories", token, data),

  updateRateCategory: (token: string, id: string, data: Partial<RateCategoryInput>) =>
    put<{ rate_category: RateCategory }>(`/admin/rate-categories/${id}`, token, data),

  deleteRateCategory: (token: string, id: string) => del(`/admin/rate-categories/${id}`, token),

  createBrand: (token: string, data: BrandInput) => post<{ brand: Brand }>("/admin/brands", token, data),

  updateBrand: (token: string, id: string, data: Partial<BrandInput>) => put<{ brand: Brand }>(`/admin/brands/${id}`, token, data),

  host: (token: string, id: string) => api<{ host: AdminHostDetail }>(`/admin/hosts/${id}`, { token }),

  /** rate_category_id: an id pins the level by hand, null returns it to automatic. */
  updateHost: (token: string, id: string, data: AdminHostInput) => put<{ host: AdminHostDetail }>(`/admin/hosts/${id}`, token, data),

  /** Hosts' personal data changes: waiting (oldest first) or decided (latest 50). */
  profileChanges: (token: string, status: "pending" | "decided" = "pending") =>
    api<{ requests: ProfileChangeRequest[]; pending_count: number }>(`/admin/profile-changes${query({ status })}`, { token }),
  approveChange: (token: string, id: string) => post(`/admin/profile-changes/${id}/approve`, token),
  rejectChange: (token: string, id: string, note: string) => post(`/admin/profile-changes/${id}/reject`, token, { note }),
};
