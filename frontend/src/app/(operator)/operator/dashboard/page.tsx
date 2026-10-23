"use client";

import Link from "next/link";
import { ArrowLeftRight, ArrowRight, CalendarDays, FileText, Flag, RefreshCw, Ticket, Users, Video } from "lucide-react";
import { dashboardApi } from "@/lib/api";
import { formatClock, formatFullDay } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import ErrorState from "@/components/ErrorState";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const REFRESH_MS = 60_000;

const shortcuts = [
  { href: "/operator/schedules", label: "Atur jadwal", description: "Slot mingguan per brand", icon: CalendarDays },
  { href: "/operator/backups", label: "Putuskan backup", description: "Pilih pengganti host", icon: ArrowLeftRight },
  { href: "/operator/reports", label: "Cek laporan live", description: "Setujui atau tolak jam", icon: FileText },
  { href: "/operator/events", label: "Kelola event", description: "Blok live event brand", icon: Ticket },
  { href: "/operator/points", label: "Poin & SP", description: "Catat pelanggaran", icon: Flag },
  { href: "/operator/hosts", label: "Host & brand", description: "Tugaskan host ke brand", icon: Users },
];

/** What needs the operator today, with one click to where it's handled. */
export default function OperatorDashboardPage() {
  const { token } = useAuth();
  const dashboard = useApiData("operator-dashboard", () => dashboardApi.operator(token).then((data) => ({ ...data, loadedAt: new Date() })), {
    refetchInterval: REFRESH_MS,
  });
  const { reload, loading } = dashboard;
  const stats = dashboard.data?.stats;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={formatFullDay()}
        actions={
          dashboard.data && (
            <Button type="button" variant="outline" size="sm" onClick={reload} disabled={loading} className="text-muted-foreground">
              <RefreshCw className={cn(loading && "animate-spin")} aria-hidden="true" />
              Diperbarui {formatClock(dashboard.data.loadedAt)}
            </Button>
          )
        }
      />

      {dashboard.error && <ErrorState message={dashboard.error} onRetry={reload} />}

      {!stats && !dashboard.error && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Memuat">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-32 rounded-xl" />
          ))}
        </div>
      )}

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={CalendarDays}
            tone="brand"
            label="Slot live hari ini"
            value={stats.today_schedules}
            note="Lihat jadwal per brand"
            href="/operator/schedules"
          />
          <StatCard
            icon={ArrowLeftRight}
            tone={stats.pending_backups > 0 ? "warning" : "neutral"}
            label="Backup perlu diputuskan"
            value={stats.pending_backups}
            note={stats.pending_backups > 0 ? "Pilih penggantinya sebelum sesi mulai" : "Tidak ada yang menunggu"}
            href="/operator/backups"
          />
          <StatCard
            icon={FileText}
            tone={stats.reports_to_review > 0 ? "warning" : "neutral"}
            label="Laporan ditandai"
            value={stats.reports_to_review}
            note={stats.reports_to_review > 0 ? "Perlu dicek manual" : "Semua laporan aman"}
            href="/operator/reports"
          />
          <StatCard
            icon={Video}
            tone="success"
            label="Host aktif"
            value={
              <>
                {stats.active_hosts}
                <span className="text-lg font-medium text-faint"> / {stats.total_hosts}</span>
              </>
            }
            note="Dari semua host terdaftar"
            href="/operator/hosts"
          />
        </div>
      )}

      <Card title="Tindakan cepat">
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {shortcuts.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex items-center gap-3 rounded-lg border border-border px-3.5 py-3 transition-colors outline-none hover:border-input hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-brand">
                  <item.icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{item.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                </span>
                <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
