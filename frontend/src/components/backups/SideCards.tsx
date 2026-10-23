"use client";

import { CalendarClock, Inbox } from "lucide-react";
import { type BackupRecap, type BackupRequest } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { timeUntil, useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { ListSkeleton } from "../Loading";
import UserAvatar from "../UserAvatar";

const statTones = {
  warning: "bg-warning/12 text-warning",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  danger: "bg-destructive/10 text-destructive",
};

/** A count that also opens its tab. */
export function Stat({
  icon: Icon,
  tone,
  label,
  value,
  note,
  active,
  onClick,
}: {
  icon: typeof Inbox;
  tone: keyof typeof statTones;
  label: string;
  value: number | undefined;
  note: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-card p-4 text-left shadow-xs transition-colors outline-none hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5 dark:shadow-none",
        active ? "border-primary/40 ring-1 ring-primary/20" : "border-border"
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", statTones[tone])}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </span>
      <span className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value ?? "–"}</span>
      <span className="mt-0.5 truncate text-xs text-muted-foreground">{note}</span>
    </button>
  );
}

/** The next sessions that have (or had) a backup request, soonest first. */
export function StartingSoon({
  ref,
  requests,
  loading,
  onShow,
}: {
  ref: (node: HTMLElement | null) => void;
  requests: BackupRequest[];
  loading: boolean;
  onShow: (backup: BackupRequest) => void;
}) {
  // The countdowns tick here, not on the whole desk
  const now = useNow(60_000);
  const soon = requests
    .filter((backup) => new Date(backup.end_at) > now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 5);

  return (
    <section ref={ref} className="rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Mulai segera</h2>
      </header>
      {loading ? (
        <div className="p-4">
          <ListSkeleton rows={3} />
        </div>
      ) : soon.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">Tidak ada sesi mendatang yang perlu backup.</p>
      ) : (
        <ul className="divide-y divide-border">
          {soon.map((backup) => {
            const started = new Date(backup.start_at) <= now;
            return (
              <li key={backup.id}>
                <button
                  type="button"
                  onClick={() => onShow(backup)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                >
                  {backup.requester && <UserAvatar user={backup.requester.user} size="size-8 text-xs" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{backup.requester?.user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {backup.brand.name} · {formatClock(backup.start_at)}–{formatClock(backup.end_at)}
                    </span>
                    <span className={cn("mt-1 block text-xs font-medium", backup.status === "filled" ? "text-success" : "text-warning")}>
                      {backup.status === "filled"
                        ? `Aman · ${backup.filler?.user.name ?? "ada pengganti"}`
                        : backup.status === "pending"
                          ? "Perlu diputuskan"
                          : "Belum ada pendaftar"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {started ? "berjalan" : timeUntil(new Date(backup.start_at), now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** How past requests turned out, and who covered most. */
/** `innerRef` measures the content at its natural height (the card itself may stretch). */
export function Recap({ recap, className, innerRef }: { recap: BackupRecap | undefined; className?: string; innerRef: (node: HTMLDivElement | null) => void }) {
  const total = recap?.total ?? 0;
  const filled = recap?.filled ?? 0;
  const auto = recap?.auto_filled ?? 0;
  const dropped = total - filled;
  const top = recap?.top_covers ?? [];
  const rate = total > 0 ? Math.round((filled / total) * 100) : 0;

  return (
    <section className={cn("rounded-xl border border-border bg-card shadow-xs dark:shadow-none", className)}>
      <div ref={innerRef}>
        <header className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Ringkasan riwayat</h2>
          <span className="text-xs text-muted-foreground">{recap && total >= recap.window ? `${recap.window} terakhir` : `${total} permintaan`}</span>
        </header>
        {!recap ? (
          <div className="p-4">
            <ListSkeleton rows={2} />
          </div>
        ) : total === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">Belum ada riwayat backup.</p>
        ) : (
          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Terisi</span>
                <span className="font-semibold text-foreground tabular-nums">{rate}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Permintaan terisi"
                aria-valuenow={rate}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full rounded-full bg-success" style={{ width: `${rate}%` }} />
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ["Terisi", filled],
                  ["Otomatis", auto],
                  ["Tidak terisi", dropped],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col-reverse rounded-lg bg-muted/50 px-2 py-2">
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold text-foreground tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {top.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Paling sering menggantikan</p>
                <ul className="space-y-2">
                  {top.map((cover, index) => (
                    <li key={cover.name} className="flex items-center gap-2.5 text-sm">
                      <span className="w-3 text-xs font-semibold text-faint tabular-nums">{index + 1}</span>
                      <UserAvatar user={{ name: cover.name, avatar_url: cover.avatar_url }} size="size-6 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{cover.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{cover.count}×</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
