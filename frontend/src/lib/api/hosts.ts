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

export interface Brand {
  id: string;
  name: string;
  is_obs: boolean;
  /** What hosts assigned to the brand need to know (products, prices, talking points) */
  product_knowledge?: string | null;
  /** A pay period runs until this many hours are reached; the brand's leader then requests payment */
  target_hours_per_period: number;
  /** First day of the first payment period; each next one starts the day after the last one ended */
  payroll_start_date?: string | null;
  status: "active" | "inactive";
}

export type BrandInput = Omit<Brand, "id">;

export interface BrandSummary extends Brand {
  active_hosts_count: number;
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
  has_ktp_image: boolean;
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

export interface MyProfile {
  user: AuthUser;
  host_profile: (HostProfile & { sensitive_data: SensitiveDataMasked | null; assignments: Assignment[] }) | null;
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

  uploadKtpImage: (token: string, image: File) => {
    const body = new FormData();
    body.append("ktp_image", image);
    return post<MyProfile & Message>("/host/profile/ktp-image", token, body);
  },

  /** Brands I'm actively assigned to, then the ones I cover a backup or an event block for soon, with their product knowledge. */
  brands: (token: string) => api<{ brands: MyBrand[] }>("/host/brands", { token }),

  /** One brand's product knowledge (one I'm assigned to, or cover a backup or event block for). */
  brand: (token: string, id: string) => api<{ brand: Omit<MyBrand, "via"> }>(`/host/brands/${id}`, { token }),
};

export type MyBrand = Pick<Brand, "id" | "name" | "is_obs"> & {
  product_knowledge: string | null;
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

export const adminHostsApi = {
  rateCategories: (token: string) => api<{ rate_categories: (RateCategory & { hosts_count: number })[] }>("/admin/rate-categories", { token }),

  createRateCategory: (token: string, data: RateCategoryInput) => post<{ rate_category: RateCategory }>("/admin/rate-categories", token, data),

  updateRateCategory: (token: string, id: string, data: Partial<RateCategoryInput>) =>
    put<{ rate_category: RateCategory }>(`/admin/rate-categories/${id}`, token, data),

  deleteRateCategory: (token: string, id: string) => del(`/admin/rate-categories/${id}`, token),

  createBrand: (token: string, data: BrandInput) => post<{ brand: Brand }>("/admin/brands", token, data),

  updateBrand: (token: string, id: string, data: Partial<BrandInput>) => put<{ brand: Brand }>(`/admin/brands/${id}`, token, data),

  host: (token: string, id: string) => api<{ host: AdminHostDetail }>(`/admin/hosts/${id}`, { token }),

  /** rate_category_id: an id pins the level by hand, null returns it to automatic. */
  updateHost: (token: string, id: string, data: AdminHostInput) => put<{ host: AdminHostDetail }>(`/admin/hosts/${id}`, token, data),

  ktpImageUrl: (token: string, id: string) => apiFileUrl(`/admin/hosts/${id}/ktp-image`, token),
};
