"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { notificationApi, type AppNotification } from "@/lib/api";
import { APP_TIME_ZONE, formatRelative } from "@/lib/format";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "./AuthProvider";

const POLL_MS = 60_000;

/** The bell: unread count (refreshed every minute) and a panel of recent notifications. */
export default function NotificationBell({ align = "end" }: { align?: "start" | "end" }) {
  const { token } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const count = useApiData("notification-count", () => notificationApi.unreadCount(token), { refetchInterval: POLL_MS });
  const list = useApiData("notification-list", () => notificationApi.list(token), { enabled: open });
  const invalidate = useInvalidate();

  async function openNotification(notification: AppNotification) {
    if (!notification.read_at) await notificationApi.read(token, notification.id).catch(() => {});
    setOpen(false);
    void invalidate("notification-"); // the count now, the list when the bell opens again
    if (notification.link) router.push(notification.link);
  }

  async function readAll() {
    await notificationApi.readAll(token).catch(() => {});
    count.reload();
    list.reload();
  }

  const unread = count.data?.unread ?? 0;
  const notifications = list.data?.notifications ?? [];
  const loading = list.loading && notifications.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"}
          className="relative text-muted-foreground hover:text-foreground"
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-background">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align={align} sideOffset={8} className="w-[min(24rem,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Notifikasi</p>
          {unread > 0 && (
            <Button type="button" variant="ghost" size="xs" onClick={readAll} className="text-brand hover:text-brand">
              <CheckCheck aria-hidden="true" />
              Tandai semua dibaca
            </Button>
          )}
        </div>

        <ul className="max-h-[min(26rem,70vh)] divide-y divide-border overflow-y-auto overscroll-contain">
          {loading &&
            [0, 1, 2].map((index) => (
              <li key={index} className="space-y-2 px-4 py-3">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </li>
            ))}

          {list.data && !list.loading && notifications.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <BellOff className="size-4" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium text-foreground">Belum ada notifikasi</p>
              <p className="text-xs text-muted-foreground">Kabar soal jadwal, backup dan gaji muncul di sini.</p>
            </li>
          )}

          {notifications.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                onClick={() => openNotification(notification)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted",
                  !notification.read_at && "bg-primary/[0.04]"
                )}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", notification.read_at ? "bg-transparent" : "bg-primary")} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", notification.read_at ? "text-body" : "font-medium text-foreground")}>{notification.title}</span>
                  {notification.body && <span className="mt-0.5 block text-xs text-muted-foreground">{notification.body}</span>}
                  <span
                    className="mt-1 block text-[11px] text-faint"
                    title={new Date(notification.created_at).toLocaleString("id-ID", { timeZone: APP_TIME_ZONE })}
                  >
                    {formatRelative(notification.created_at)}
                  </span>
                </span>
                {!notification.read_at && <span className="sr-only">(belum dibaca)</span>}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
