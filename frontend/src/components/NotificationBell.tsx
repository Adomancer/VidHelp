"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { notificationApi, type AppNotification } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";

const POLL_MS = 60_000;

/**
 * The bell: unread count (refreshed every minute) and a dropdown of recent notifications.
 * `align` picks which side the panel opens toward.
 */
export default function NotificationBell({ align = "right" }: { align?: "left" | "right" }) {
  const { token } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const count = useApiData("notification-count", () => notificationApi.unreadCount(token));
  const list = useApiData(`notification-list-${open}`, () =>
    open ? notificationApi.list(token) : Promise.resolve({ notifications: [] as AppNotification[], unread: 0 })
  );
  const reloadCount = count.reload;

  useEffect(() => {
    const timer = setInterval(reloadCount, POLL_MS);
    return () => clearInterval(timer);
  }, [reloadCount]);

  // Close when clicking outside the panel
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function openNotification(notification: AppNotification) {
    if (!notification.read_at) await notificationApi.read(token, notification.id).catch(() => {});
    setOpen(false);
    count.reload();
    if (notification.link) router.push(notification.link);
  }

  async function readAll() {
    await notificationApi.readAll(token).catch(() => {});
    count.reload();
    list.reload();
  }

  const unread = count.data?.unread ?? 0;

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"}
        className="relative w-9 h-9 rounded-full flex items-center justify-center text-gray-300 hover:bg-slate-800 hover:text-white"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <p className="text-sm font-medium text-white">Notifikasi</p>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="text-xs text-purple-300 hover:text-white">
                Tandai semua dibaca
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-slate-800">
            {list.loading && !list.data?.notifications.length && <li className="px-4 py-6 text-center text-sm text-gray-400">Memuat…</li>}
            {list.data && !list.loading && list.data.notifications.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-gray-400">Belum ada notifikasi.</li>
            )}
            {list.data?.notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-800 ${notification.read_at ? "" : "bg-purple-600/10"}`}
                >
                  <span className="flex items-start gap-2">
                    {!notification.read_at && <span className="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-purple-400" aria-hidden="true" />}
                    <span className="min-w-0">
                      <span className="block text-sm text-white">{notification.title}</span>
                      {notification.body && <span className="block text-xs text-gray-400 mt-0.5">{notification.body}</span>}
                      <span className="block text-[11px] text-gray-500 mt-1">{formatDateTime(notification.created_at)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
