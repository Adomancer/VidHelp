/** Weekly schedule slots and hosts' availability. */

import { api, type Message, post, put, del, query } from "./client";
import type { AuthUser } from "./auth";
import type { Assignment, HostProfile } from "./hosts";
import type { BackupNeed, SlotBackupMarker } from "./backups";
import type { MyEventClaim, ReplacingEvent } from "./events";

/** ISO weekday: 1 = Monday ... 7 = Sunday */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ScheduleSlot {
  id: string;
  assignment_id: string;
  /** The slot this one continues after an edit that applied from a later date. */
  previous_slot_id: string | null;
  day_of_week: DayOfWeek;
  slot_type: "regular" | "pd";
  /** "HH:MM" */
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  is_locked: boolean;
  status: "active" | "inactive";
  effective_from: string;
  effective_to: string | null;
  assignment: Assignment & { host?: HostProfile & { user: AuthUser } };
}

export interface SlotInput {
  assignment_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_type: ScheduleSlot["slot_type"];
  effective_from: string;
  effective_to: string | null;
}

/** A new slot on one or more days (e.g. every day): one weekly slot per day. */
export type NewSlotInput = Omit<SlotInput, "day_of_week"> & { days_of_week: number[] };

export interface AvailabilityRange {
  day_of_week: DayOfWeek;
  available_from: string;
  available_to: string;
  note: string | null;
}

export interface BrandHost extends Omit<Assignment, "brand"> {
  host: HostProfile & { user: AuthUser; availability: AvailabilityRange[] };
}

/** An existing slot that a new or edited one would clash with. */
export interface SlotConflict {
  id: string;
  host_name: string;
  brand_name: string;
  /** The same host elsewhere; otherwise another host on the same brand. */
  same_host: boolean;
  day_of_week: DayOfWeek;
  start_time: string;
  end_time: string;
}

/** One audit row about a slot; values are raw columns ("14:00:00", "2026-10-06 00:00:00"). */
export interface SlotHistoryEntry {
  id: string;
  action: "create" | "update" | "delete";
  target_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
  user: { id: string; name: string } | null;
}

export const scheduleApi = {
  /** Slots in effect on `on`, or on any of the `days` days from it. */
  list: (token: string, params: { brand_id?: string; host_id?: string; on?: string; days?: number }) =>
    api<{ slots: ScheduleSlot[]; backups: SlotBackupMarker[]; replacing_events: ReplacingEvent[] }>(`/operator/schedules${query(params)}`, { token }),

  brandHosts: (token: string, brandId: string) => api<{ assignments: BrandHost[] }>(`/operator/brands/${brandId}/hosts`, { token }),

  /** One slot per day in `days_of_week`, all or none; `slot` is the first. */
  create: (token: string, data: SlotInput | NewSlotInput) => post<{ slot: ScheduleSlot; slots: ScheduleSlot[] }>("/operator/schedules", token, data),

  /**
   * With `apply_from` after the slot started, the slot ends the day before and the
   * changes continue as a new slot (`previous` = the ended one); otherwise edited in place.
   */
  update: (token: string, id: string, data: Partial<SlotInput> & { apply_from?: string }) =>
    put<{ slot: ScheduleSlot; previous?: ScheduleSlot }>(`/operator/schedules/${id}`, token, data),

  /** Ends the slot from today (or `from`) on; deletes it if it hasn't started by then. */
  remove: (token: string, id: string, from?: string) => del(`/operator/schedules/${id}${query({ from })}`, token),

  /** Clashes on any of the days (`days_of_week` for a new slot on several days). */
  conflicts: (
    token: string,
    params: Omit<SlotInput, "slot_type" | "day_of_week"> & ({ day_of_week: number } | { days_of_week: number[] }) & { ignore_id?: string }
  ) => api<{ conflicts: SlotConflict[] }>(`/operator/schedules/conflicts${query(params)}`, { token }),

  history: (token: string, id: string) => api<{ history: SlotHistoryEntry[] }>(`/operator/schedules/${id}/history`, { token }),

  /** Take back a slot just added, or an edit that continued a slot (`slot` = the one it continued). */
  undo: (token: string, id: string) => post<{ slot: ScheduleSlot | null } & Message>(`/operator/schedules/${id}/undo`, token),

  /** Admin only. */
  lock: (token: string, id: string, isLocked: boolean) => put<{ slot: ScheduleSlot }>(`/admin/schedules/${id}/lock`, token, { is_locked: isLocked }),

  /** covers: backups I do for others; absences: my sessions someone else covers (the next `days` days, 7 by default). */
  mine: (token: string, days?: number) =>
    api<{
      slots: ScheduleSlot[];
      upcoming: ScheduleSlot[];
      covers: BackupNeed[];
      absences: SlotBackupMarker[];
      event_claims: MyEventClaim[];
      replacing_events: ReplacingEvent[];
    }>(`/host/schedules${query({ days })}`, { token }),

  myAvailability: (token: string) => api<{ availability: AvailabilityRange[] }>("/host/availability", { token }),

  saveAvailability: (token: string, ranges: AvailabilityRange[]) =>
    put<{ availability: AvailabilityRange[] } & Message>("/host/availability", token, { ranges }),
};
