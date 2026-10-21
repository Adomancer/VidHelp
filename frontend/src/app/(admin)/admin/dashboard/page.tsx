"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, CalendarDays, ClipboardCheck, Layers, Radio, RefreshCw, Tag, Wallet } from "lucide-react";
import { dashboardApi, type AdminDashboard, type BrandProgress, type DashboardBackup, type SessionState, type TodaySession } from "@/lib/api";
import { compactRupiah, dayWord, formatClock, formatDuration, formatRupiah, formatShortDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { reasonLabels } from "@/components/BackupBadges";
import DashboardTile, { TileScroll } from "@/components/DashboardTile";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import HoursChart from "@/components/HoursChart";
import HoursStat from "@/components/HoursStat";
import NavIcon, { navIcon, type NavIconName } from "@/components/NavIcon";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import StatusBadge, { toneFill, type Tone } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const REFRESH_MS = 60_000;

/**
 * On laptops the dashboard fills the screen under the AppShell header (3.5rem, plus p-6 / 2xl:p-8
 * around the page) so the page itself never scrolls; long lists scroll inside their tile.
 * Very short windows fall back to scrolling the page.
 */
const FIT_SCREEN = "xl:h-[calc(100svh-6.5rem)] xl:min-h-[34rem] 2xl:h-[calc(100svh-7.5rem)]";

type AttentionKey = keyof AdminDashboard["attention"];

/** Urgent items are time-bound (a live without a host, a report already late) and sort first. */
const attentionItems: { key: AttentionKey; label: string; href: string; icon: NavIconName; urgent?: boolean }[] = [
  { key: "backups_uncovered_soon", label: "Backup tanpa pengganti, mulai dalam 24 jam", href: "/admin/backups?tab=open", icon: "backup", urgent: true },
  { key: "reports_missing", label: "Laporan live terlambat", href: "/admin/reports", icon: "report", urgent: true },
  { key: "reports_flagged", label: "Laporan live yang ditandai", href: "/admin/reports", icon: "report" },
  { key: "backups_pending", label: "Pendaftar backup yang perlu diputuskan", href: "/admin/backups?tab=pending", icon: "backup" },
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

/** Same words as the tabs on the backup desk. */
const backupStyles: Record<DashboardBackup["status"], { label: string; tone: Tone }> = {
  open: { label: "Belum ada pendaftar", tone: "danger" },
  pending: { label: "Perlu diputuskan", tone: "warning" },
};

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
    <div className={cn("flex flex-col gap-4", FIT_SCREEN)}>
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
        <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <LiveStat counts={data.today.counts} />
            <TodayStat sessions={data.today.sessions} counts={data.today.counts} />
            <HoursStat days={data.hours_by_day} />
            <PayStat brands={data.brands} />
            <HostsStat people={data.people} />
            <WarningStat people={data.people} />
          </div>

          {/* Today runs down the left; the other tiles fill a 2 × 2 grid beside it */}
          <div className="grid gap-3 md:grid-cols-2 xl:min-h-0 xl:flex-1 xl:grid-cols-3 xl:grid-rows-2">
            <Today sessions={data.today.sessions} counts={data.today.counts} className="md:col-span-2 xl:col-span-1 xl:row-span-2" />
            <Backups backups={data.backups} />
            <Attention attention={data.attention} />
            <HoursTile days={data.hours_by_day} />
            <Brands brands={data.brands} />
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1" aria-busy="true" aria-label="Memuat">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:flex-1 xl:grid-cols-3 xl:grid-rows-2">
        <Skeleton className="h-96 rounded-xl md:col-span-2 xl:col-span-1 xl:row-span-2 xl:h-auto" />
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-64 rounded-xl xl:h-auto" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat row                                                          */
/* ------------------------------------------------------------------ */

function LiveStat({ counts }: { counts: AdminDashboard["today"]["counts"] }) {
  const live = counts.live ?? 0;
  const late = counts.late ?? 0;
  const missed = counts.missed ?? 0;

  return (
    <StatCard
      compact
      icon={Radio}
      tone="success"
      label="Sedang live"
      value={
        <span className="inline-flex items-center gap-2">
          {live}
          {live > 0 && (
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
          )}
        </span>
      }
      note={
        late === 0 && missed === 0 ? (
          "Semua check-in tepat waktu"
        ) : (
          <>
            {late > 0 && <span className="font-medium text-warning">{late} telat</span>}
            {late > 0 && missed > 0 && " · "}
            {missed > 0 && <span className="font-medium text-destructive">{missed} terlewat</span>}
          </>
        )
      }
    />
  );
}

function TodayStat({ sessions, counts }: { sessions: TodaySession[]; counts: AdminDashboard["today"]["counts"] }) {
  const total = sessions.length;
  const done = counts.done ?? 0;

  return (
    <StatCard
      compact
      icon={CalendarDays}
      tone="brand"
      label="Sesi selesai"
      value={
        <>
          {done}
          <span className="text-base font-medium text-faint"> / {total}</span>
        </>
      }
      note={total === 0 ? "Tidak ada sesi hari ini" : `${counts.upcoming ?? 0} akan datang`}
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
      compact
      icon={Wallet}
      tone="neutral"
      label="Gaji berjalan"
      value={<span title={formatRupiah(pay)}>{compactRupiah(pay)}</span>}
      note={
        gmvTracked ? (
          <span title={`GMV dilaporkan ${formatRupiah(gmv)}`}>
            GMV <span className="font-medium text-body">{compactRupiah(gmv)}</span>
          </span>
        ) : (
          `Perkiraan dari ${running.length} brand`
        )
      }
    />
  );
}

function HostsStat({ people }: { people: AdminDashboard["people"] }) {
  return (
    <StatCard
      compact
      icon={navIcon("host")}
      tone="brand"
      label="Host aktif"
      href="/admin/hosts"
      value={people.active_hosts}
      note={`${people.operators} operator · ${people.admins} admin`}
    />
  );
}

function WarningStat({ people }: { people: AdminDashboard["people"] }) {
  return (
    <StatCard
      compact
      icon={navIcon("points")}
      tone={people.warning_letters > 0 ? "warning" : "neutral"}
      label="SP periode ini"
      href="/admin/points"
      value={people.warning_letters}
      note={`Sejak ${formatShortDate(people.points_period.start)}`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

function Today({ sessions, counts, className }: { sessions: TodaySession[]; counts: AdminDashboard["today"]["counts"]; className?: string }) {
  const [filter, setFilter] = useState<SessionState | "all">("all");
  const present = stateOrder.filter((state) => counts[state]);
  // A filter whose sessions all moved on (e.g. late → live) falls back to everything
  const active = filter !== "all" && !counts[filter] ? "all" : filter;
  // Sessions arrive in time order; "all" puts the ones needing eyes (live, late, missed) on top
  const shown =
    active === "all"
      ? [...sessions].sort((a, b) => stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state))
      : sessions.filter((session) => session.state === active);

  return (
    <DashboardTile title="Sesi hari ini" link={{ href: "/admin/schedules", label: "Jadwal" }} className={className}>
      {sessions.length === 0 ? (
        <EmptyState compact icon={CalendarDays} title="Tidak ada sesi terjadwal hari ini" className="flex-1" />
      ) : (
        <>
          {/* Share of today's sessions per state; labels and counts are in the chips below */}
          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {present.map((state) => (
              <div
                key={state}
                className={cn(toneFill[stateStyles[state].tone], state === "done" && "opacity-60")}
                style={{ flexGrow: counts[state] }}
                title={`${stateStyles[state].label}: ${counts[state]}`}
              />
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Saring sesi">
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

          <TileScroll label="Daftar sesi hari ini" className="-mx-4 mt-3 -mb-4 rounded-b-xl border-t border-border">
            <ul className="divide-y divide-border">
              {shown.map((session) => (
                <li key={`${session.host.id}-${session.start_at}`} className="px-4 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">{session.host.name}</p>
                    <StatusBadge tone={stateStyles[session.state].tone} dot pulse={session.state === "live"} className="h-5 px-1.5 text-[11px]">
                      {stateStyles[session.state].label}
                    </StatusBadge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {formatClock(session.start_at)}–{formatClock(session.end_at)}
                    </span>
                    {" · "}
                    {session.brand.name}
                    {session.role === "cover" && session.covered_for && ` · menggantikan ${session.covered_for}`}
                    {session.role === "event" && session.event_name && ` · event: ${session.event_name}`}
                    {session.check_in_at && session.state === "live" && ` · check-in ${formatClock(session.check_in_at)}`}
                  </p>
                </li>
              ))}
            </ul>
          </TileScroll>
        </>
      )}
    </DashboardTile>
  );
}

function FilterChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-6 md:px-2.5",
        selected ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-body hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

/** Upcoming backups nobody covers yet; each row opens its tab on the backup desk. */
function Backups({ backups }: { backups: DashboardBackup[] }) {
  return (
    <DashboardTile
      title="Kebutuhan backup"
      aside={backups.length > 0 && <StatusBadge tone="warning">{backups.length}</StatusBadge>}
      link={{ href: "/admin/backups", label: "Backup" }}
    >
      {backups.length === 0 ? (
        <EmptyState compact icon={ArrowLeftRight} title="Semua backup sudah ada pengganti" className="flex-1" />
      ) : (
        <TileScroll label="Daftar kebutuhan backup" className="-mx-4 -mb-4 rounded-b-xl border-t border-border">
          <ul className="divide-y divide-border">
            {backups.map((backup) => {
              const style = backupStyles[backup.status];
              return (
                <li key={backup.id}>
                  <Link
                    href={`/admin/backups?tab=${backup.status}`}
                    className="block px-4 py-2 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm">
                        <span className="font-medium text-foreground">{backup.brand.name}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {backup.requester_name} ({reasonLabels[backup.reason_type].toLowerCase()})
                        </span>
                      </p>
                      <StatusBadge tone={style.tone} className="h-5 px-1.5 text-[11px]">
                        {style.label}
                      </StatusBadge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
                      {dayWord(backup.start_at)}, {formatClock(backup.start_at)}–{formatClock(backup.end_at)}
                      {backup.status === "pending" && ` · ${backup.applicants_count} pendaftar`}
                      {backup.status === "pending" && backup.auto_fill_at && ` · otomatis ${formatClock(backup.auto_fill_at)}`}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </TileScroll>
      )}
    </DashboardTile>
  );
}

/** Work waiting on staff; each row opens the page where it's handled. */
function Attention({ attention }: { attention: AdminDashboard["attention"] }) {
  const waiting = attentionItems.filter((item) => attention[item.key] > 0);
  const total = waiting.reduce((sum, item) => sum + attention[item.key], 0);

  return (
    <DashboardTile title="Perlu perhatian" aside={total > 0 && <StatusBadge tone="warning">{total}</StatusBadge>}>
      {waiting.length === 0 ? (
        <EmptyState compact icon={ClipboardCheck} title="Semua beres" description="Tidak ada yang perlu kamu tangani." className="flex-1" />
      ) : (
        <TileScroll label="Daftar yang perlu perhatian" className="-mx-2">
          <ul className="space-y-0.5">
            {waiting.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-2.5 rounded-lg px-2 py-1 transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-md",
                      item.urgent ? "bg-destructive/10 text-destructive" : "bg-warning/12 text-warning"
                    )}
                  >
                    <NavIcon name={item.icon} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] leading-snug text-body group-hover:text-foreground">
                    {item.label}
                    {item.urgent && <span className="sr-only"> (mendesak)</span>}
                  </span>
                  <span className="text-sm font-semibold text-foreground tabular-nums">{attention[item.key]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </TileScroll>
      )}
    </DashboardTile>
  );
}

function HoursTile({ days }: { days: AdminDashboard["hours_by_day"] }) {
  const total = days.reduce((sum, day) => sum + day.hours, 0);

  return (
    <DashboardTile
      title="Jam live disetujui"
      aside={
        <span className="truncate text-xs text-muted-foreground">
          {days.length} hari{total > 0 && ` · ${formatDuration(total)}`}
        </span>
      }
    >
      {total > 0 ? (
        <HoursChart days={days} className="xl:h-auto xl:min-h-0 xl:flex-1" />
      ) : (
        <EmptyState compact icon={Layers} title={`Belum ada jam yang disetujui dalam ${days.length} hari terakhir`} className="flex-1" />
      )}
    </DashboardTile>
  );
}

function Brands({ brands }: { brands: BrandProgress[] }) {
  return (
    <DashboardTile title="Target brand, periode ini" link={{ href: "/admin/payroll", label: "Penggajian" }}>
      {brands.length === 0 ? (
        <EmptyState compact icon={Tag} title="Belum ada brand aktif" className="flex-1" />
      ) : (
        <TileScroll label="Daftar target brand">
          <ul className="space-y-3.5">
            {brands.map((brand) => (
              <BrandRow key={brand.id} brand={brand} />
            ))}
          </ul>
        </TileScroll>
      )}
    </DashboardTile>
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
      <Progress value={percent} aria-label={`Jam ${brand.name}`} className="mt-1.5 h-1.5" indicatorClassName={percent >= 100 ? "bg-success" : undefined} />
      <div className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
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
