/** Special events (PD, double date): blocks hosts claim, and the operator's event manager. */

import { api, del, type Message, post, put } from "./client";

export interface SpecialEvent {
  id: string;
  brand_id: string;
  name: string;
  start_date: string;
  end_date: string;
  /** "HH:MM"; an end before the start runs past midnight */
  daily_start_time: string;
  daily_end_time: string;
  block_minutes: number;
  open_full_schedule: boolean;
  max_slots_per_host: number;
  status: "active" | "cancelled";
  brand?: { id: string; name: string };
}

export interface EventListItem extends SpecialEvent {
  claimed_blocks: number;
  total_blocks: number;
}

/** mine | taken | past | unavailable (brand's regular schedule) | busy (you) | free */
export type BlockState = "mine" | "taken" | "past" | "unavailable" | "busy" | "free";

export interface EventBlock {
  start_at: string;
  end_at: string;
  state: BlockState;
  reason: string | null;
  claim: { id: string; host_id: string; host_name: string } | null;
}

export interface HostEvent extends SpecialEvent {
  my_claims: number;
  blocks: EventBlock[];
}

/** A block I claimed, as shown on my schedule. */
export interface MyEventClaim {
  id: string;
  event_name: string;
  brand: { id: string; name: string };
  date: string;
  start_at: string;
  end_at: string;
}

/** An event whose days replace a brand's regular schedule. */
export interface ReplacingEvent {
  id: string;
  brand_id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export type EventInput = Omit<SpecialEvent, "id" | "status" | "brand">;

export const eventApi = {
  list: (token: string) => api<{ events: EventListItem[] }>("/operator/events", { token }),
  show: (token: string, id: string) => api<{ event: SpecialEvent; blocks: EventBlock[] }>(`/operator/events/${id}`, { token }),
  create: (token: string, data: EventInput) => post<{ event: SpecialEvent } & Message>("/operator/events", token, data),
  /** Anything but the brand; new dates/hours must keep every block a host holds (else a `schedule` error). */
  update: (token: string, id: string, data: Partial<Omit<EventInput, "brand_id">>) => put<{ event: SpecialEvent } & Message>(`/operator/events/${id}`, token, data),
  /** Refused (`event` error) once a host has checked in for one of its blocks. */
  remove: (token: string, id: string) => del<Message>(`/operator/events/${id}`, token),
  assign: (token: string, id: string, startAt: string, hostId: string) =>
    post<{ claim: { id: string } } & Message>(`/operator/events/${id}/assign`, token, { start_at: startAt, host_id: hostId }),
  release: (token: string, claimId: string) => post<Message>(`/operator/event-claims/${claimId}/release`, token),

  // Hosts
  /** Events of my brands; `my_brands` = the brands whose events I'd see. */
  mine: (token: string) => api<{ events: HostEvent[]; my_brands: string[] }>("/host/events", { token }),
  claim: (token: string, id: string, startAt: string) => post<{ claim: { id: string } } & Message>(`/host/events/${id}/claim`, token, { start_at: startAt }),
  cancelClaim: (token: string, claimId: string) => post(`/host/event-claims/${claimId}/cancel`, token),
};
