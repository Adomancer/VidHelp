"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, CalendarDays, Flag, Layers, LogIn, LogOut, RefreshCw, Star, Ticket, Wallet } from "lucide-react";
import { CHECK_IN_OPENS_MINUTES, dashboardApi, errorMessage, liveApi, type HostDashboard, type HostDashboardSession, type SessionState } from "@/lib/api";
import { compactHours, compactRupiah, dayWord, formatClock, formatDuration, formatRupiah, formatShortDate, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { timeUntil, useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { KnowledgeButton } from "@/components/BrandKnowledge";
import DashboardTile, { TileScroll } from "@/components/DashboardTile";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { useHostEvents } from "@/components/EventClaimBoard";
import FormAlert from "@/components/FormAlert";
import HoursChart from "@/components/HoursChart";
import HoursStat from "@/components/HoursStat";
import NavIcon, { type NavIconName } from "@/components/NavIcon";
import PageHeader from "@/components/PageHeader";
import PeriodBadge from "@/components/PeriodBadge";
import StatCard from "@/components/StatCard";
import StatusBadge, { toneFill, type Tone } from "@/components/StatusBadge";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const REFRESH_MS = 60_000;
/** Same pace as the Event badge in the menu, so both share one request. */
const EVENTS_REFRESH_MS = 60_000;

type Attention = HostDashboard["attention"];

/** Things with a deadline (a report already due, a doctor's letter) are urgent and sort first. */
const todoItems: { key: keyof Attention; label: string; href: string; icon: NavIconName; urgent?: boolean }[] = [
  { key: "reports_to_send", label: "Laporan live belum dikirim", href: "/host/live", icon: "report", urgent: true },
  { key: "sick_letters_due", label: "Surat dokter belum diunggah", href: "/host/backups?tab=mine", icon: "backup", urgent: true },
  { key: "periods_to_request", label: "Periode brand siap diajukan pembayarannya", href: "/host/pay", icon: "payroll" },
  { key: "backups_uncovered", label: "Permintaan backup-mu belum ada pengganti", href: "/host/backups?tab=mine", icon: "backup" },
];

const stateStyles: Record<Exclude<SessionState, "upcoming">, { label: string; tone: Tone }> = {
  live: { label: "Sedang live", tone: "success" },
  late: { label: "Belum check-in", tone: "warning" },
  missed: { label: "Tidak check-in", tone: "danger" },
  done: { label: "Selesai", tone: "neutral" },
};

/** The bar beside each session in the week list. */
const roleFill: Record<HostDashboardSession["role"], string> = {
  own: "bg-primary",
  cover: toneFill.info,
  event: "bg-chart-2",
  off: "bg-border",
};

/**
 * The session's state now: the server's, moved on by the clock between loads
 * (an upcoming session that has started without a check-in is late, then missed).
 */
function stateNow(session: HostDashboardSession, now: Date): SessionState | null {
  if (session.state === null || session.check_in_at) return session.state;
  if (new Date(session.end_at) <= now) return "missed";
  if (new Date(session.start_at) <= now) return "late";
  return "upcoming";
}

const hoursOf = (session: HostDashboardSession) => (new Date(session.end_at).getTime() - new Date(session.start_at).getTime()) / 3_600_000;

/** My overview: what's next, what I still have to do, chances for more hours, pay and score. */
export default function HostDashboardPage() {
  const { token, user } = useAuth();
  const isHost = user.roles.some((role) => role.name === "host");
  // Stamp each load so the header can say how fresh the numbers are
  const dashboard = useApiData("host-dashboard", () => dashboardApi.host(token).then((data) => ({ data, loadedAt: new Date() })), {
    refetchInterval: REFRESH_MS,
  });
  const events = useHostEvents(isHost, EVENTS_REFRESH_MS);
  const now = useNow();
  const { reload, loading } = dashboard;
  const data = dashboard.data?.data;
  const updatedAt = dashboard.data?.loadedAt;
  const todos = data ? todoList(data) : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Halo, ${user.name.split(" ")[0]}`}
        description={now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          updatedAt && (
            <Button type="button" variant="outline" size="sm" onClick={reload} disabled={loading} className="text-muted-foreground">
              <RefreshCw className={cn(loading && "animate-spin")} aria-hidden="true" />
              Diperbarui {formatClock(updatedAt)}
            </Button>
          )
        }
      />

      {dashboard.error && <ErrorState message={dashboard.error} onRetry={reload} />}
      {!data && !dashboard.error && <DashboardSkeleton />}

      {data && (
        <>
          {/* What to do now; the to-do list beside it only when there is something on it */}
          <div className="grid gap-3 lg:grid-cols-3">
            <NextUp sessions={data.sessions} now={now} onChanged={reload} className={todos.length > 0 ? "lg:col-span-2" : "lg:col-span-3"} />
            {todos.length > 0 && <Todo items={todos} />}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HoursStat days={data.hours_by_day} />
            <PayStat pay={data.pay} />
            <PointsStat points={data.points} />
            <RatingStat rating={data.rating} max={data.rating_max} />
          </div>

          {/* The week runs down the left; the other tiles fill the space beside it */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {/* Height 0 + full height: the week takes the height of the tiles beside it and scrolls inside */}
            <Week sessions={data.sessions} now={now} className="md:row-span-2 md:h-0 md:min-h-full md:overflow-hidden xl:min-h-full" />
            <Chances claimable={events.data ? events.claimable : null} covers={data.cover_chances} />
            <HoursTile days={data.hours_by_day} />
            <Pay pay={data.pay} className="md:col-span-2" />
          </div>
        </>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Memuat">
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-xl lg:col-span-2" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-96 rounded-xl md:row-span-2 md:h-auto" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Now: the session to act on                                          */
/* ------------------------------------------------------------------ */

/** Live now, started without a check-in, or the next one coming up (sessions are in time order). */
function focusOf(sessions: HostDashboardSession[], now: Date): { session: HostDashboardSession; state: "live" | "late" | "upcoming" } | null {
  for (const state of ["live", "late", "upcoming"] as const) {
    const session = sessions.find((candidate) => stateNow(candidate, now) === state);
    if (session) return { session, state };
  }
  return null;
}

const focusStyles = {
  live: { eyebrow: "Sedang live", tone: "text-success", frame: "border-success/40 bg-success/5" },
  late: { eyebrow: "Kamu belum check-in", tone: "text-warning", frame: "border-warning/40 bg-warning/5" },
  upcoming: { eyebrow: "Sesi berikutnya", tone: "text-brand", frame: "" },
};

function NextUp({ sessions, now, onChanged, className }: { sessions: HostDashboardSession[]; now: Date; onChanged: () => void; className?: string }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focus = focusOf(sessions, now);

  if (!focus) {
    return (
      <section className={cn("flex rounded-xl border border-border bg-card shadow-xs dark:shadow-none", className)}>
        <EmptyState
          compact
          icon={CalendarDays}
          title="Tidak ada sesi dalam 7 hari ke depan"
          description="Mau tambah jam live? Ambil blok event atau gantikan host yang berhalangan."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/host/events">
                  <Ticket aria-hidden="true" />
                  Event
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/host/backups">
                  <ArrowLeftRight aria-hidden="true" />
                  Backup
                </Link>
              </Button>
            </div>
          }
          className="flex-1"
        />
      </section>
    );
  }

  const { session, state } = focus;
  const style = focusStyles[state];
  const start = new Date(session.start_at);
  const end = new Date(session.end_at);
  const opensAt = new Date(start.getTime() - CHECK_IN_OPENS_MINUTES * 60_000);
  const canCheckIn = state === "late" || (state === "upcoming" && opensAt <= now);
  const elapsed = Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100));
  const later = sessions.find((candidate) => candidate !== session && candidate.start_at > session.start_at && stateNow(candidate, now) === "upcoming");

  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      notify({ text: (await liveApi.checkIn(token, session)).message });
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
    setBusy(false);
  }

  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 shadow-xs dark:shadow-none", style.frame, className)}>
      <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className={cn("flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase", style.tone)}>
            {state === "live" && (
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
            )}
            {style.eyebrow}
            {state === "upcoming" && <span className="font-medium tracking-normal text-muted-foreground normal-case">· {dayWord(session.start_at, now)}</span>}
          </p>
          <h2 className="mt-2 truncate text-2xl font-semibold tracking-tight text-foreground">{session.brand.name}</h2>
          <p className="mt-1 text-sm text-body tabular-nums">
            {formatClock(session.start_at)}–{formatClock(session.end_at)} · {formatDuration(hoursOf(session))}
          </p>
          {session.role === "cover" && <p className="mt-1.5 text-xs font-medium text-info">Backup untuk {session.covered_for}</p>}
          {session.role === "event" && <p className="mt-1.5 text-xs font-medium text-brand">Event: {session.event_name}</p>}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <p className={cn("text-sm tabular-nums", state === "late" ? "font-medium text-warning" : "text-muted-foreground")}>
            {state === "live" && (end > now ? `Selesai ${formatClock(end)} · ${timeUntil(end, now)}` : "Waktunya selesai: check-out dan kirim laporan")}
            {state === "late" && `Mulai ${formatClock(start)}, check-in sekarang`}
            {state === "upcoming" && (canCheckIn ? `Check-in sudah dibuka · mulai ${timeUntil(start, now)}` : `Mulai ${timeUntil(start, now)}`)}
          </p>
          <div className="flex gap-2">
            <KnowledgeButton brand={session.brand} compact className="sm:hidden" />
            <KnowledgeButton brand={session.brand} className="hidden sm:inline-flex" />
            {state === "live" ? (
              <Button asChild size="sm" className="flex-1 sm:flex-none">
                <Link href="/host/live">
                  <LogOut aria-hidden="true" />
                  Check-out &amp; laporan
                </Link>
              </Button>
            ) : canCheckIn ? (
              <Button type="button" variant="success" size="sm" className="flex-1 sm:flex-none" disabled={busy} onClick={checkIn}>
                <LogIn aria-hidden="true" />
                {busy ? "Memproses…" : "Check-in sekarang"}
              </Button>
            ) : dayWord(opensAt.toISOString(), now) === "Hari ini" ? (
              <span className="flex flex-1 items-center gap-1 rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground sm:flex-none">
                Check-in dibuka <span className="font-medium text-body tabular-nums">{formatClock(opensAt)}</span>
              </span>
            ) : (
              <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
                <Link href="/host/schedule">
                  <CalendarDays aria-hidden="true" />
                  Lihat jadwal
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <FormAlert tone="error" className="mt-4">
          {error}
        </FormAlert>
      )}

      {state === "live" && <Progress value={elapsed} aria-label="Waktu live berjalan" className="mt-4 h-1.5" indicatorClassName="bg-success" />}

      {later && (
        <p className="mt-4 truncate border-t border-border pt-3 text-xs text-muted-foreground">
          Setelah ini: <span className="font-medium text-body">{later.brand.name}</span>
          {later.role === "cover" && " (backup)"}
          {later.role === "event" && " (event)"}
          <span className="tabular-nums">
            {" "}
            · {dayWord(later.start_at, now)}, {formatClock(later.start_at)}–{formatClock(later.end_at)}
          </span>
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* To-do                                                               */
/* ------------------------------------------------------------------ */

type TodoItem = { key: string; label: string; href: string; icon: NavIconName; urgent?: boolean; count?: number };

function todoList(data: HostDashboard): TodoItem[] {
  const counted = todoItems.filter((item) => data.attention[item.key] > 0).map((item) => ({ ...item, count: data.attention[item.key] }));
  const urgent = counted.filter((item) => item.urgent);
  const rest = counted.filter((item) => !item.urgent);
  // Someone is waiting for my answer: right after the deadlines
  const asked: TodoItem[] =
    data.cover_chances.asked_me > 0
      ? [{ key: "asked_me", label: "Host lain memintamu jadi backup", href: "/host/backups", icon: "backup", count: data.cover_chances.asked_me }]
      : [];
  const discord: TodoItem[] = data.discord_unlinked
    ? [{ key: "discord", label: "Hubungkan Discord untuk pengingat jadwal", href: "/host/profile#discord", icon: "notifications" }]
    : [];

  return [...urgent, ...asked, ...rest, ...discord];
}

function Todo({ items }: { items: TodoItem[] }) {
  const total = items.reduce((sum, item) => sum + (item.count ?? 0), 0);

  return (
    <DashboardTile title="Perlu kamu lakukan" aside={total > 0 && <StatusBadge tone="warning">{total}</StatusBadge>}>
      <ul className="-mx-2 space-y-0.5">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md",
                  item.urgent ? "bg-destructive/10 text-destructive" : item.count ? "bg-warning/12 text-warning" : "bg-muted text-muted-foreground"
                )}
              >
                <NavIcon name={item.icon} className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-body group-hover:text-foreground">
                {item.label}
                {item.urgent && <span className="sr-only"> (mendesak)</span>}
              </span>
              {item.count ? (
                <span className="text-sm font-semibold text-foreground tabular-nums">{item.count}</span>
              ) : (
                <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </DashboardTile>
  );
}

/* ------------------------------------------------------------------ */
/* Stat row                                                            */
/* ------------------------------------------------------------------ */

function PayStat({ pay }: { pay: HostDashboard["pay"] }) {
  const total = pay.periods.reduce((sum, period) => sum + period.estimate, 0);

  return (
    <StatCard
      compact
      icon={Wallet}
      tone="success"
      label="Perkiraan gaji"
      href="/host/pay"
      value={<span title={formatRupiah(total)}>{compactRupiah(total)}</span>}
      note={
        pay.advance_outstanding > 0 ? (
          <span title={formatRupiah(pay.advance_outstanding)}>Sisa kasbon {compactRupiah(pay.advance_outstanding)}</span>
        ) : pay.periods.length > 0 ? (
          `Dari ${pay.periods.length} periode berjalan`
        ) : (
          "Belum ada jam yang disetujui"
        )
      }
    />
  );
}

function PointsStat({ points }: { points: HostDashboard["points"] }) {
  const tone: Tone = points.sp_level >= 3 ? "danger" : points.sp_level > 0 ? "warning" : "success";

  return (
    <StatCard
      compact
      icon={Flag}
      tone={tone}
      label="Poin disiplin"
      href="/host/rating"
      value={
        <>
          {points.points}
          <span className="text-base font-medium text-faint"> / {points.opening_points}</span>
        </>
      }
      note={
        <>
          {points.sp_level > 0 && <span className={cn("font-medium", points.sp_level >= 3 ? "text-destructive" : "text-warning")}>SP{points.sp_level} · </span>}
          Periode sampai {formatShortDate(points.period.end)}
        </>
      }
    />
  );
}

function RatingStat({ rating, max }: { rating: HostDashboard["rating"]; max: number }) {
  const month = rating && new Date(`${rating.month_year}-01T00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  return (
    <StatCard
      compact
      icon={Star}
      tone="brand"
      label="Rating"
      href="/host/rating"
      value={
        rating ? (
          <>
            {rating.rating.toLocaleString("id-ID", { maximumFractionDigits: 1 })}
            <span className="text-base font-medium text-faint"> / {max}</span>
          </>
        ) : (
          <span className="text-faint">–</span>
        )
      }
      note={rating ? `Bulan ${month}` : "Belum ada rating"}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

function Week({ sessions, now, className }: { sessions: HostDashboardSession[]; now: Date; className?: string }) {
  const working = sessions.filter((session) => session.role !== "off");
  const total = working.reduce((sum, session) => sum + hoursOf(session), 0);
  // One group per day it starts on, in order
  const days = new Map<string, HostDashboardSession[]>();
  for (const session of sessions) {
    const day = toDateInput(new Date(session.start_at));
    days.set(day, [...(days.get(day) ?? []), session]);
  }

  return (
    <DashboardTile
      title="Jadwal 7 hari"
      aside={
        working.length > 0 && (
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {working.length} sesi · {formatDuration(total)}
          </span>
        )
      }
      link={{ href: "/host/schedule", label: "Jadwal" }}
      className={className}
    >
      {sessions.length === 0 ? (
        <EmptyState compact icon={CalendarDays} title="Belum ada jadwal minggu ini" description="Jadwal mingguanmu diatur oleh operator." className="flex-1" />
      ) : (
        <TileScroll label="Sesi 7 hari ke depan" className="-mx-4 -mb-4 rounded-b-xl border-t border-border md:max-h-none md:flex-1">
          {[...days].map(([day, list]) => (
            <div key={day} className="border-b border-border last:border-b-0">
              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{dayWord(day, now)}</p>
              <ul>
                {list.map((session) => (
                  <WeekRow
                    key={`${session.role}-${session.slot_id ?? session.event_claim_id}-${session.start_at}`}
                    session={session}
                    state={stateNow(session, now)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </TileScroll>
      )}
    </DashboardTile>
  );
}

function WeekRow({ session, state }: { session: HostDashboardSession; state: SessionState | null }) {
  const off = session.role === "off";
  const badge = state && state !== "upcoming" ? stateStyles[state] : null;
  const note =
    session.role === "cover"
      ? `Backup untuk ${session.covered_for}`
      : session.role === "event"
        ? `Event: ${session.event_name}`
        : off
          ? `Libur, digantikan ${session.covered_by ?? "host lain"}`
          : null;

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <div className="w-11 shrink-0 text-right tabular-nums">
        <p className={cn("text-sm font-medium", off ? "text-muted-foreground" : "text-foreground")}>{formatClock(session.start_at)}</p>
        <p className="text-[11px] text-muted-foreground">{formatClock(session.end_at)}</p>
      </div>
      <span className={cn("w-0.5 self-stretch rounded-full", roleFill[session.role])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", off ? "text-muted-foreground line-through decoration-faint" : "text-foreground")}>
          {session.brand.name}
        </p>
        {note && (
          <p className={cn("truncate text-xs", session.role === "cover" ? "text-info" : session.role === "event" ? "text-brand" : "text-muted-foreground")}>
            {note}
          </p>
        )}
      </div>
      {badge && (
        <StatusBadge tone={badge.tone} dot pulse={state === "live"} className="h-5 px-1.5 text-[11px]">
          {badge.label}
        </StatusBadge>
      )}
    </li>
  );
}

/** Ways to get more hours: free event blocks and other hosts' backups I could take. */
function Chances({ claimable, covers }: { claimable: number | null; covers: HostDashboard["cover_chances"] }) {
  return (
    <DashboardTile title="Tambah jam live">
      <ul className="space-y-2">
        <ChanceRow
          href="/host/events"
          icon={Ticket}
          count={claimable}
          label="Blok event bisa diambil"
          note={claimable ? "Siapa cepat dia dapat" : "Belum ada blok yang kosong"}
        />
        <ChanceRow
          href="/host/backups"
          icon={ArrowLeftRight}
          count={covers.count}
          label="Backup bisa kamu ambil"
          note={
            covers.asked_me > 0
              ? `${covers.asked_me} memintamu langsung`
              : covers.count > 0
                ? "Gantikan host yang berhalangan"
                : "Belum ada yang butuh pengganti"
          }
          highlight={covers.asked_me > 0}
        />
      </ul>
    </DashboardTile>
  );
}

function ChanceRow({
  href,
  icon: Icon,
  count,
  label,
  note,
  highlight = false,
}: {
  href: string;
  icon: typeof Ticket;
  /** null while loading */
  count: number | null;
  label: string;
  note: string;
  highlight?: boolean;
}) {
  const some = (count ?? 0) > 0;

  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-lg border border-border px-3.5 py-3 transition-colors outline-none hover:border-input hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span
          className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", some ? "bg-primary/10 text-brand" : "bg-muted text-muted-foreground")}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{label}</span>
          <span className={cn("block truncate text-xs", highlight ? "font-medium text-warning" : "text-muted-foreground")}>{note}</span>
        </span>
        <span className={cn("text-xl font-semibold tabular-nums", some ? "text-foreground" : "text-faint")}>{count ?? "–"}</span>
        <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </li>
  );
}

function HoursTile({ days }: { days: HostDashboard["hours_by_day"] }) {
  const total = days.reduce((sum, day) => sum + day.hours, 0);

  return (
    <DashboardTile
      title="Jam live-mu disetujui"
      aside={
        <span className="truncate text-xs text-muted-foreground">
          {days.length} hari{total > 0 && ` · ${formatDuration(total)}`}
        </span>
      }
    >
      {total > 0 ? (
        <HoursChart days={days} className="h-44" />
      ) : (
        <EmptyState
          compact
          icon={Layers}
          title={`Belum ada jam yang disetujui dalam ${days.length} hari terakhir`}
          description="Jam masuk setelah laporan live-mu disetujui."
          className="flex-1"
        />
      )}
    </DashboardTile>
  );
}

/** Pay so far per brand period, and how far the brand is from the target that gets it paid. */
function Pay({ pay, className }: { pay: HostDashboard["pay"]; className?: string }) {
  return (
    <DashboardTile title="Gaji berjalan" link={{ href: "/host/pay", label: "Gaji" }} className={className}>
      {pay.periods.length === 0 ? (
        <EmptyState compact icon={Wallet} title="Belum ada gaji berjalan" description="Gaji dihitung dari jam live yang sudah disetujui." className="flex-1" />
      ) : (
        <>
          <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {pay.periods.map((period) => {
              const percent = period.target_hours > 0 ? Math.min(100, (period.brand_hours / period.target_hours) * 100) : 0;
              const left = Math.max(0, period.target_hours - period.brand_hours);
              return (
                <li key={period.period_id} className="min-w-0 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate">
                      <span className="font-medium text-foreground">{period.brand.name}</span>
                      <span className="text-xs text-muted-foreground"> · sejak {formatShortDate(period.period_start)}</span>
                    </p>
                    <p className="shrink-0 font-semibold text-foreground tabular-nums">{formatRupiah(period.estimate)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatDuration(period.hours)} dibayar · {formatRupiah(period.rate_per_hour)}/jam
                    {period.carried_out_hours > 0 && ` · ${formatDuration(period.carried_out_hours)} dibawa ke periode berikutnya`}
                  </p>
                  <Progress
                    value={percent}
                    aria-label={`Target jam ${period.brand.name}`}
                    className="mt-2 h-1.5"
                    indicatorClassName={percent >= 100 ? "bg-success" : undefined}
                  />
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate tabular-nums" title={`${formatDuration(period.brand_hours)} dari ${formatDuration(period.target_hours)}`}>
                      Target brand {compactHours(period.brand_hours)} / {compactHours(period.target_hours)}
                    </span>
                    {period.status === "in_progress" ? (
                      <span className="shrink-0 tabular-nums">kurang {compactHours(left)}</span>
                    ) : (
                      <PeriodBadge status={period.status} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-faint">
            Perkiraan dengan tarifmu saat ini. Dibayar setelah brand mencapai target jamnya dan membayar.
            {pay.advance_outstanding > 0 && ` Sisa kasbon ${formatRupiah(pay.advance_outstanding)} dicicil dari gajimu.`}
          </p>
        </>
      )}
    </DashboardTile>
  );
}
