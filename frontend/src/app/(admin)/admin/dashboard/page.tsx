"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ClipboardCheck, Layers, RefreshCw, Tag, TrendingDown, TrendingUp, Video, Wallet } from "lucide-react";
import { dashboardApi, type AdminDashboard, type BrandProgress, type SessionState, type TodaySession } from "@/lib/api";
import { formatClock, formatDate, formatDuration, formatRupiah, formatShortDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import HoursChart from "@/components/HoursChart";
import NavIcon, { type NavIconName } from "@/components/NavIcon";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import StatusBadge, { toneFill, type Tone } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const REFRESH_MS = 60_000;

type AttentionKey = keyof AdminDashboard["attention"];

/** Urgent items are time-bound (a live without a host, a report already late) and sort first. */
const attentionItems: { key: AttentionKey; label: string; href: string; icon: NavIconName; urgent?: boolean }[] = [
  { key: "backups_uncovered_soon", label: "Backup tanpa pengganti, mulai dalam 24 jam", href: "/admin/backups", icon: "backup", urgent: true },
  { key: "reports_missing", label: "Laporan live terlambat", href: "/admin/reports", icon: "report", urgent: true },
  { key: "reports_flagged", label: "Laporan live yang ditandai", href: "/admin/reports", icon: "report" },
  { key: "backups_pending", label: "Pendaftar backup yang perlu diputuskan", href: "/admin/backups", icon: "backup" },
  { key: "pending_signups", label: "Pendaftar yang perlu disetujui", href: "/admin/users", icon: "users" },
  { key: "periods_to_request", label: "Periode gaji siap ditagihkan", href: "/admin/payroll", icon: "payroll" },
  { key: "periods_awaiting_brand", label: "Periode gaji menunggu brand", href: "/admin/payroll", icon: "payroll" },
];

const stateStyles: Record<SessionState, { label: string; tone: Tone }> = {
  live: { label: "Sedang live", tone: "success" },
  late: { label: "Belum check-in", tone: "warning" },
  missed: { label: "Terlewat", tone: "danger" },
  done: { label: "Selesai", tone: "neutral" },
  upcoming: { label: "Akan datang", tone: "info" },
};

const stateOrder: SessionState[] = ["live", "late", "missed", "upcoming", "done"];

/** Rows a list tile shows before "show more"; tiles grow instead of scrolling inside. */
const SESSION_ROWS = 7;
const BRAND_ROWS = 4;

export default function AdminDashboardPage() {
  const { token } = useAuth();
  // Stamp each load so the header can say how fresh the numbers are
  // Check-ins and new requests change through the day
  const dashboard = useApiData("admin-dashboard", () => dashboardApi.admin(token).then((data) => ({ data, loadedAt: new Date() })), {
    refetchInterval: REFRESH_MS,
  });
  const { reload, loading } = dashboard;
  const data = dashboard.data?.data;
  const updatedAt = dashboard.data?.loadedAt;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12">
          <LiveStat counts={data.today.counts} />
          <TodayStat sessions={data.today.sessions} counts={data.today.counts} />
          <HoursStat days={data.hours_by_day} />
          <PayStat brands={data.brands} />

          <Today sessions={data.today.sessions} counts={data.today.counts} />
          <Attention attention={data.attention} />
          <People people={data.people} />

          <HoursTile days={data.hours_by_day} />
          <Brands brands={data.brands} />
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-12" aria-busy="true" aria-label="Memuat">
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-32 rounded-xl xl:col-span-3" />
      ))}
      <Skeleton className="h-96 rounded-xl sm:col-span-2 xl:col-span-8" />
      <Skeleton className="h-96 rounded-xl sm:col-span-2 xl:col-span-4" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

/** One cell of the bento grid; `className` sets its span. */
function Tile({
  title,
  link,
  aside,
  className = "",
  children,
}: {
  title?: string;
  link?: { href: string; label: string };
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col rounded-xl border border-border bg-card p-5 shadow-xs dark:shadow-none", className)}>
      {(title || link || aside) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {title && <h2 className="truncate text-base font-semibold tracking-tight text-foreground">{title}</h2>}
            {aside}
          </div>
          {link && (
            <Link
              href={link.href}
              className="group inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {link.label}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stat row                                                            */
/* ------------------------------------------------------------------ */

function LiveStat({ counts }: { counts: AdminDashboard["today"]["counts"] }) {
  const live = counts.live ?? 0;
  const late = counts.late ?? 0;
  const missed = counts.missed ?? 0;

  return (
    <StatCard
      icon={Video}
      tone="success"
      label="Sedang live"
      className="xl:col-span-3"
      value={
        <span className="inline-flex items-center gap-2.5">
          {live}
          {live > 0 && (
            <span className="relative flex size-2.5" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-success" />
            </span>
          )}
        </span>
      }
      note={
        late === 0 && missed === 0 ? (
          "Semua host check-in tepat waktu"
        ) : (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {late > 0 && <span className="font-medium text-warning">{late} belum check-in</span>}
            {missed > 0 && <span className="font-medium text-destructive">{missed} terlewat</span>}
          </span>
        )
      }
    />
  );
}

function TodayStat({ sessions, counts }: { sessions: TodaySession[]; counts: AdminDashboard["today"]["counts"] }) {
  const total = sessions.length;
  const done = counts.done ?? 0;
  const percent = total > 0 ? (done / total) * 100 : 0;

  return (
    <StatCard
      icon={CalendarDays}
      tone="brand"
      label="Sesi selesai hari ini"
      className="xl:col-span-3"
      value={
        <>
          {done}
          <span className="text-lg font-medium text-faint"> / {total}</span>
        </>
      }
      note={
        total === 0 ? (
          "Tidak ada sesi terjadwal"
        ) : (
          <div className="space-y-1.5">
            <Progress value={percent} aria-label="Sesi selesai hari ini" className="h-1.5" />
            <p>{counts.upcoming ?? 0} sesi akan datang</p>
          </div>
        )
      }
    />
  );
}

/** 12.5 → "12j 30m": short enough for a headline number. */
function compactHours(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}j` : `${h}j ${m}m`;
}

/** Last 7 days against the 7 before, from the 14-day series. */
function HoursStat({ days }: { days: AdminDashboard["hours_by_day"] }) {
  const sum = (list: AdminDashboard["hours_by_day"]) => list.reduce((total, day) => total + day.hours, 0);
  const recent = sum(days.slice(-7));
  const previous = sum(days.slice(0, -7));
  const change = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null;
  const Trend = change !== null && change < 0 ? TrendingDown : TrendingUp;

  return (
    <StatCard
      icon={Layers}
      tone="info"
      label="Jam disetujui, 7 hari"
      className="xl:col-span-3"
      value={compactHours(recent)}
      note={
        change === null ? (
          "Belum ada pembanding 7 hari sebelumnya"
        ) : (
          <span className="inline-flex items-center gap-1">
            <span className={cn("inline-flex items-center gap-0.5 font-medium", change >= 0 ? "text-success" : "text-destructive")}>
              <Trend className="size-3.5" aria-hidden="true" />
              {change >= 0 ? "+" : "−"}
              {Math.abs(change)}%
            </span>
            dibanding 7 hari sebelumnya
          </span>
        )
      }
    />
  );
}

function PayStat({ brands }: { brands: BrandProgress[] }) {
  const running = brands.filter((brand) => brand.period);
  const pay = running.reduce((total, brand) => total + (brand.total_amount ?? 0), 0);
  const gmvTracked = running.some((brand) => brand.gmv != null);
  const gmv = running.reduce((total, brand) => total + (brand.gmv ?? 0), 0);

  return (
    <StatCard
      icon={Wallet}
      tone="neutral"
      label="Gaji host, periode berjalan"
      className="xl:col-span-3"
      value={formatRupiah(pay)}
      note={
        gmvTracked ? (
          <>
            GMV dilaporkan <span className="font-medium text-body">{formatRupiah(gmv)}</span>
          </>
        ) : (
          `Perkiraan dari ${running.length} brand, tarif saat ini`
        )
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Big tiles                                                           */
/* ------------------------------------------------------------------ */

function Today({ sessions, counts }: { sessions: TodaySession[]; counts: AdminDashboard["today"]["counts"] }) {
  const [filter, setFilter] = useState<SessionState | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const present = stateOrder.filter((state) => counts[state]);
  // A filter whose sessions all moved on (e.g. late → live) falls back to everything
  const active = filter !== "all" && !counts[filter] ? "all" : filter;
  // Sessions arrive in time order; "all" puts the ones needing eyes (live, late, missed) on top
  const matching =
    active === "all"
      ? [...sessions].sort((a, b) => stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state))
      : sessions.filter((session) => session.state === active);
  const shown = expanded ? matching : matching.slice(0, SESSION_ROWS);

  return (
    <Tile title="Sesi hari ini" link={{ href: "/admin/schedules", label: "Jadwal" }} className="sm:col-span-2 xl:col-span-8 xl:row-span-2">
      {sessions.length === 0 ? (
        <EmptyState compact icon={CalendarDays} title="Tidak ada sesi terjadwal hari ini" className="flex-1" />
      ) : (
        <>
          {/* Share of today's sessions per state; labels and counts are in the chips below */}
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {present.map((state) => (
              <div
                key={state}
                className={cn(toneFill[stateStyles[state].tone], state === "done" && "opacity-60")}
                style={{ flexGrow: counts[state] }}
                title={`${stateStyles[state].label}: ${counts[state]}`}
              />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Saring sesi">
            <FilterChip selected={active === "all"} onClick={() => setFilter("all")}>
              Semua <span className="text-muted-foreground tabular-nums">{sessions.length}</span>
            </FilterChip>
            {present.map((state) => (
              <FilterChip key={state} selected={active === state} onClick={() => setFilter(state)}>
                <span className={cn("size-1.5 rounded-full", toneFill[stateStyles[state].tone])} aria-hidden="true" />
                {stateStyles[state].label} <span className="text-muted-foreground tabular-nums">{counts[state]}</span>
              </FilterChip>
            ))}
          </div>

          <ul className="-mx-5 mt-3 divide-y divide-border border-t border-border">
            {shown.map((session) => (
              <li key={`${session.host.id}-${session.start_at}`} className="flex items-center gap-4 px-5 py-3 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                  {formatClock(session.start_at)}–{formatClock(session.end_at)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{session.host.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {session.brand.name}
                    {session.role === "cover" && session.covered_for && ` · menggantikan ${session.covered_for}`}
                    {session.role === "event" && session.event_name && ` · event: ${session.event_name}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusBadge tone={stateStyles[session.state].tone} dot pulse={session.state === "live"}>
                    {stateStyles[session.state].label}
                  </StatusBadge>
                  {session.check_in_at && session.state === "live" && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">sejak {formatClock(session.check_in_at)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <ShowMore hidden={matching.length - SESSION_ROWS} expanded={expanded} onToggle={() => setExpanded(!expanded)} unit="sesi" />
        </>
      )}
    </Tile>
  );
}

/** Footer toggle for a list tile cut to its first rows; renders nothing when everything fits. */
function ShowMore({ hidden, expanded, onToggle, unit }: { hidden: number; expanded: boolean; onToggle: () => void; unit: string }) {
  if (hidden <= 0) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="-mx-5 mt-auto -mb-5 rounded-b-xl border-t border-border px-5 py-3 text-center text-xs font-medium text-brand transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
    >
      {expanded ? "Tampilkan lebih sedikit" : `Tampilkan ${hidden} ${unit} lainnya`}
    </button>
  );
}

function FilterChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-body hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

/** Work waiting on staff; each row opens the page where it's handled. */
function Attention({ attention }: { attention: AdminDashboard["attention"] }) {
  const waiting = attentionItems.filter((item) => attention[item.key] > 0);
  const total = waiting.reduce((sum, item) => sum + attention[item.key], 0);

  return (
    <Tile title="Perlu perhatian" aside={total > 0 && <StatusBadge tone="warning">{total}</StatusBadge>} className="sm:col-span-2 xl:col-span-4">
      {waiting.length === 0 ? (
        <EmptyState compact icon={ClipboardCheck} title="Semua beres" description="Tidak ada yang perlu kamu tangani." className="flex-1" />
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {waiting.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    item.urgent ? "bg-destructive/10 text-destructive" : "bg-warning/12 text-warning"
                  )}
                >
                  <NavIcon name={item.icon} className="size-4" />
                </span>
                <span className="min-w-0 flex-1 text-sm text-body group-hover:text-foreground">
                  {item.label}
                  {item.urgent && <span className="sr-only"> (mendesak)</span>}
                </span>
                <span className="text-base font-semibold text-foreground tabular-nums">{attention[item.key]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

function People({ people }: { people: AdminDashboard["people"] }) {
  const items: { label: string; value: number; href: string; icon: NavIconName }[] = [
    { label: "Host aktif", value: people.active_hosts, href: "/admin/hosts", icon: "host" },
    { label: "Operator", value: people.operators, href: "/admin/users", icon: "users" },
    { label: "Admin", value: people.admins, href: "/admin/users", icon: "security" },
    { label: `SP sejak ${formatDate(people.points_period.start)}`, value: people.warning_letters, href: "/admin/points", icon: "points" },
  ];

  return (
    <Tile title="Tim" className="sm:col-span-2 xl:col-span-4">
      <div className="grid grid-cols-2 gap-2.5">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 transition-colors outline-none hover:border-input hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <NavIcon name={item.icon} className="size-5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xl leading-tight font-semibold text-foreground tabular-nums">{item.value}</p>
              <p className="truncate text-xs text-muted-foreground">{item.label}</p>
            </div>
          </Link>
        ))}
      </div>
    </Tile>
  );
}

function HoursTile({ days }: { days: AdminDashboard["hours_by_day"] }) {
  const total = days.reduce((sum, day) => sum + day.hours, 0);

  return (
    <Tile
      title="Jam live disetujui, 14 hari"
      aside={total > 0 && <span className="text-sm text-muted-foreground">· total {formatDuration(total)}</span>}
      className="sm:col-span-2 xl:col-span-8"
    >
      {total > 0 ? <HoursChart days={days} /> : <EmptyState compact icon={Layers} title="Belum ada jam yang disetujui dalam 14 hari terakhir" className="flex-1" />}
    </Tile>
  );
}

function Brands({ brands }: { brands: BrandProgress[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? brands : brands.slice(0, BRAND_ROWS);

  return (
    <Tile title="Target brand, periode ini" link={{ href: "/admin/payroll", label: "Penggajian" }} className="sm:col-span-2 xl:col-span-4">
      {brands.length === 0 ? (
        <EmptyState compact icon={Tag} title="Belum ada brand aktif" className="flex-1" />
      ) : (
        <>
          <ul className={cn("space-y-5", brands.length > BRAND_ROWS && "pb-4")}>
            {shown.map((brand) => (
              <BrandRow key={brand.id} brand={brand} />
            ))}
          </ul>
          <ShowMore hidden={brands.length - BRAND_ROWS} expanded={expanded} onToggle={() => setExpanded(!expanded)} unit="brand" />
        </>
      )}
    </Tile>
  );
}

function BrandRow({ brand }: { brand: BrandProgress }) {
  if (!brand.period) {
    return (
      <li className="text-sm">
        <p className="font-medium text-foreground">{brand.name}</p>
        <p className="text-xs text-muted-foreground">
          Belum ada tanggal mulai penggajian.{" "}
          <Link href="/admin/brands" className="font-medium text-brand hover:underline">
            Atur
          </Link>
        </p>
      </li>
    );
  }

  const achieved = brand.achieved_hours ?? 0;
  const target = brand.target_hours ?? 0;
  const percent = target > 0 ? Math.min(100, (achieved / target) * 100) : 0;
  const hoursLeft = brand.period.hours_left;
  const carriedIn = brand.carried_in_hours ?? 0;
  const carriedOut = brand.carried_out_hours ?? 0;

  return (
    <li className="text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate font-medium text-foreground">{brand.name}</p>
        <p className="shrink-0 text-xs text-body tabular-nums" title="Gaji host (perkiraan, tarif saat ini)">
          {formatRupiah(brand.total_amount ?? 0)}
        </p>
      </div>
      <Progress value={percent} aria-label={`Jam ${brand.name}`} className="mt-2 h-1.5" indicatorClassName={percent >= 100 ? "bg-success" : undefined} />
      <div className="mt-1.5 flex justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {formatDuration(achieved)} / {formatDuration(target)} · {Math.round(percent)}%
        </span>
        <span className="shrink-0" title={`Sejak ${formatShortDate(brand.period.start)}`}>
          {hoursLeft > 0 ? `kurang ${formatDuration(hoursLeft)}` : "target tercapai"}
        </span>
      </div>
      {(brand.gmv != null || carriedIn > 0 || carriedOut > 0) && (
        <p className="mt-0.5 text-[11px] text-faint">
          {[
            brand.gmv != null && `GMV ${formatRupiah(brand.gmv)}`,
            carriedIn > 0 && `termasuk ${formatDuration(carriedIn)} bawaan`,
            carriedOut > 0 && `${formatDuration(carriedOut)} dibawa ke periode berikutnya`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </li>
  );
}
