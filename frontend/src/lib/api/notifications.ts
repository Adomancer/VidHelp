/** In-app notifications and the Discord link. */

import { api, type Message, post, del, query } from "./client";

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

export interface DiscordStatus {
  /** false when the server has no Discord bot / app configured */
  available: boolean;
  link: { discord_username: string | null; linked_at: string } | null;
}

export const discordApi = {
  status: (token: string) => api<DiscordStatus>("/discord", { token }),
  connectUrl: (token: string, state: string) => api<{ url: string }>(`/discord/connect-url${query({ state })}`, { token }),
  link: (token: string, code: string) => post<{ link: NonNullable<DiscordStatus["link"]> } & Message>("/discord/link", token, { code }),
  unlink: (token: string) => del("/discord/link", token),
  test: (token: string) => post("/discord/test", token),
};
