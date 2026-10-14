/** In-app notifications and the Discord link. */

import { api, type Message, type Paginated, post, put, del, query } from "./client";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** Frontend path to open, e.g. "/host/backups" */
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export const notificationApi = {
  list: (token: string) => api<{ notifications: AppNotification[]; unread: number }>("/notifications", { token }),
  unreadCount: (token: string) => api<{ unread: number }>("/notifications/unread-count", { token }),
  read: (token: string, id: string) => post(`/notifications/${id}/read`, token),
  readAll: (token: string) => post("/notifications/read-all", token),
};

export interface DiscordLink {
  discord_username: string | null;
  linked_at: string;
  /** Categories that don't come as DMs (the bell still shows them) */
  muted: string[];
  /** Discord refused the last DM: DMs closed, or not in the agency server */
  dm_blocked: boolean;
  /** In the agency server; null when the server can't tell */
  in_guild: boolean | null;
}

export interface DiscordStatus {
  /** false when the server has no Discord bot / app configured */
  available: boolean;
  link: DiscordLink | null;
  /** Categories this user may mute, e.g. { key: "backup", label: "Backup" } */
  categories: { key: string; label: string }[];
}

export const discordApi = {
  status: (token: string) => api<DiscordStatus>("/discord", { token }),
  connectUrl: (token: string, state: string) => api<{ url: string }>(`/discord/connect-url${query({ state })}`, { token }),
  link: (token: string, code: string) => post<{ link: DiscordLink } & Message>("/discord/link", token, { code }),
  unlink: (token: string) => del("/discord/link", token),
  test: (token: string) => post("/discord/test", token),
  preferences: (token: string, muted: string[]) => put<{ link: DiscordLink } & Message>("/discord/preferences", token, { muted }),
};

/** Something set in the backend .env, checked against Discord: ok null = not checked (not set, or no bot). */
export interface DiscordCheck {
  set: boolean;
  ok: boolean | null;
  error: string | null;
}

export interface DiscordSetup {
  bot: { configured: boolean; can_connect: boolean };
  guild: DiscordCheck & { name?: string | null; members?: number | null };
  channels: (DiscordCheck & { key: "backups" | "admin"; label: string; name?: string | null; role_ping: boolean })[];
  linked: { hosts: number; hosts_total: number; staff: number; staff_total: number; dm_blocked: number };
  last_24h: Record<DeliveryStatus, number>;
}

export type DeliveryStatus = "sent" | "pending" | "failed" | "skipped";

/** One Discord message: a post to a server channel or a DM. */
export interface NotificationDelivery {
  id: string;
  type: string;
  title: string;
  channel: "discord_channel" | "discord_dm";
  /** "#backup-needs", or the person a DM went to */
  to: string;
  status: DeliveryStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface DeliveryFilters {
  status?: DeliveryStatus;
  channel?: NotificationDelivery["channel"];
  page?: number;
}

/** Where examples go: a server channel, or my own DM. */
export type PreviewTarget = "backups" | "admin" | "me";

/** The admin's Discord panel. */
export const notificationAdminApi = {
  setup: (token: string) => api<DiscordSetup>("/admin/notifications/discord", { token }),
  deliveries: (token: string, filters: DeliveryFilters) =>
    api<{ deliveries: Paginated<NotificationDelivery> }>(`/admin/notifications/deliveries${query(filters)}`, { token }),
  resend: (token: string, id: string) => post<{ delivery: NotificationDelivery } & Message>(`/admin/notifications/deliveries/${id}/resend`, token),
  testChannel: (token: string, channel: "backups" | "admin") => post("/admin/notifications/test-channel", token, { channel }),
  /** The types that have an example; then `preview(…, type)` posts one of them. */
  previewTypes: (token: string, to: PreviewTarget) => post<{ types: string[] }>("/admin/notifications/preview", token, { to }),
  preview: (token: string, to: PreviewTarget, type: string) => post("/admin/notifications/preview", token, { to, type }),
};
