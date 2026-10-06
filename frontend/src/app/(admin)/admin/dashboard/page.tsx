"use client";

import { useEffect } from "react";
import Link from "next/link";
import { dashboardApi, type AdminDashboard, type BrandProgress, type SessionState, type TodaySession } from "@/lib/api";
import { formatClock, formatDate, formatDuration, formatRupiah, formatShortDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";
import HoursChart from "@/components/HoursChart";

const REFRESH_MS = 60_000;

const attentionItems: { key: keyof AdminDashboard["attention"]; label: string; href: string }[] = [
  { key: "pending_signups", label: "Pendaftar yang perlu disetujui", href: "/admin/users" },
  { key: "backups_pending", label: "Pendaftar backup yang perlu diputuskan", href: "/admin/backups" },
  { key: "backups_uncovered_soon", label: "Backup tanpa pengganti, mulai dalam 24 jam", href: "/admin/backups" },
  { key: "reports_flagged", label: "Laporan live yang ditandai", href: "/admin/reports" },
  { key: "reports_missing", label: "Laporan live terlambat", href: "/admin/reports" },
  { key: "periods_to_request", label: "Periode gaji siap ditagihkan", href: "/admin/payroll" },
  { key: "periods_awaiting_brand", label: "Periode gaji menunggu brand", href: "/admin/payroll" },
];

const stateStyles: Record<SessionState, { label: string; className: string; dot: string }> = {
  live: { label: "Sedang live", className: "bg-green-500/15 text-success", dot: "bg-green-400" },
  late: { label: "Belum check-in", className: "bg-yellow-500/15 text-warning", dot: "bg-yellow-300" },
  missed: { label: "Terlewat", className: "bg-red-500/15 text-danger", dot: "bg-red-400" },
  done: { label: "Selesai", className: "bg-surface-3 text-body", dot: "bg-gray-400" },
  upcoming: { label: "Akan datang", className: "bg-surface-2 text-muted", dot: "bg-gray-600" },
};

const stateOrder: SessionState[] = ["live", "late", "missed", "upcoming", "done"];

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const dashboard = useApiData("admin-dashboard", () => dashboardApi.admin(token));
  const reload = dashboard.reload;

  // Check-ins and new requests change through the day
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const data = dashboard.data;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-heading">Dashboard</h1>
        <p className="text-sm text-muted mt-1">
          {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {dashboard.error && <FormAlert tone="error">{dashboard.error}</FormAlert>}
      {!data && !dashboard.error && <p className="text-muted">Memuat…</p>}

      {data && (
        <>
          <Attention attention={data.attention} />
          <Today sessions={data.today.sessions} counts={data.today.counts} />
          <Brands brands={data.brands} />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <HoursCard days={data.hours_by_day} />
            </div>
            <People people={data.people} />
          </div>
        </>
      )}
    </div>
  );
}

/** Counts of work waiting on staff; each opens the page where it's handled. */
function Attention({ attention }: { attention: AdminDashboard["attention"] }) {
  const waiting = attentionItems.filter((item) => attention[item.key] > 0);

  return (
    <section className="space-y-3">
      <h2 className="text-heading font-medium">Perlu perhatian</h2>
      {waiting.length === 0 ? (
        <p className="rounded-[10px] border border-stroke bg-surface shadow-card px-5 py-4 text-sm text-body">
          <span className="text-success">✓</span> Tidak ada yang perlu kamu tangani.
        </p>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {waiting.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="rounded-xl border border-yellow-400/30 bg-surface p-4 hover:border-yellow-300/60 hover:bg-surface-2 transition-colors"
            >
              <p className="text-2xl font-bold text-heading">{attention[item.key]}</p>
              <p className="text-sm text-body mt-1">{item.label}</p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function StateBadge({ state }: { state: SessionState }) {
  const style = stateStyles[state];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs whitespace-nowrap ${style.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}

function Today({ sessions, counts }: { sessions: TodaySession[]; counts: AdminDashboard["today"]["counts"] }) {
  return (
    <Card title="Sesi hari ini">
      {sessions.length === 0 ? (
        <p className="text-sm text-muted">Tidak ada sesi terjadwal hari ini.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {stateOrder
              .filter((state) => counts[state])
              .map((state) => (
                <span key={state} className="text-sm text-body">
                  <StateBadge state={state} /> <span className="text-heading font-medium">{counts[state]}</span>
                </span>
              ))}
          </div>
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2 border-b border-stroke">
                <tr>
                  <th className="px-5 py-2 font-medium">Jam</th>
                  <th className="px-3 py-2 font-medium">Host</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke">
                {sessions.map((session) => (
                  <tr key={`${session.host.id}-${session.start_at}`} className="text-body">
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      {formatClock(session.start_at)}–{formatClock(session.end_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-heading">{session.host.name}</span>
                      {session.role === "cover" && session.covered_for && (
                        <span className="block text-xs text-muted">menggantikan {session.covered_for}</span>
                      )}
                      {session.role === "event" && session.event_name && (
                        <span className="block text-xs text-muted">event: {session.event_name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-body">{session.brand.name}</td>
                    <td className="px-5 py-2.5">
                      <StateBadge state={session.state} />
                      {session.check_in_at && session.state === "live" && (
                        <span className="ml-2 text-xs text-muted">sejak {formatClock(session.check_in_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function Brands({ brands }: { brands: BrandProgress[] }) {
  return (
    <Card title="Brand di periode gaji ini" description="Jam yang disetujui dibanding target tiap brand. Gaji host masih perkiraan dengan tarif saat ini sampai pembayaran diajukan.">
      {brands.length === 0 ? (
        <p className="text-sm text-muted">Belum ada brand aktif.</p>
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2 border-b border-stroke">
              <tr>
                <th className="px-5 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium">Periode</th>
                <th className="px-3 py-2 font-medium min-w-48">Jam vs target</th>
                <th className="px-3 py-2 font-medium text-right">GMV dilaporkan</th>
                <th className="px-5 py-2 font-medium text-right">Gaji host (perkiraan)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke">
              {brands.map((brand) => (
                <BrandRow key={brand.id} brand={brand} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BrandRow({ brand }: { brand: BrandProgress }) {
  if (!brand.period) {
    return (
      <tr className="text-body">
        <td className="px-5 py-3 text-heading">{brand.name}</td>
        <td colSpan={4} className="px-3 py-3 text-muted">
          Belum ada tanggal mulai penggajian.{" "}
          <Link href="/admin/brands" className="text-accent hover:text-heading">
            Atur di halaman Brand
          </Link>
        </td>
      </tr>
    );
  }

  const achieved = brand.achieved_hours ?? 0;
  const target = brand.target_hours ?? 0;
  const percent = target > 0 ? Math.min(100, (achieved / target) * 100) : 0;
  const daysLeft = brand.period.days_left;

  return (
    <tr className="text-body align-top">
      <td className="px-5 py-3 text-heading">{brand.name}</td>
      <td className="px-3 py-3 whitespace-nowrap">
        {formatShortDate(brand.period.start)} – {formatShortDate(brand.period.end)}
        <span className="block text-xs text-muted">
          {daysLeft > 0 ? `sisa ${daysLeft} hari` : "selesai"}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-heading">{formatDuration(achieved)}</span>
          <span className="text-xs text-muted">dari {formatDuration(target)}</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`Jam ${brand.name}`}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        {(brand.carried_in_hours ?? 0) > 0 && (
          <span className="block text-xs text-muted mt-1">termasuk {formatDuration(brand.carried_in_hours ?? 0)} bawaan periode lalu</span>
        )}
        {(brand.carried_out_hours ?? 0) > 0 && (
          <span className="block text-xs text-muted mt-1">{formatDuration(brand.carried_out_hours ?? 0)} melebihi target, dibawa ke periode berikutnya</span>
        )}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">{brand.gmv == null ? "—" : formatRupiah(brand.gmv)}</td>
      <td className="px-5 py-3 text-right whitespace-nowrap">{formatRupiah(brand.total_amount ?? 0)}</td>
    </tr>
  );
}

function HoursCard({ days }: { days: AdminDashboard["hours_by_day"] }) {
  const total = days.reduce((sum, day) => sum + day.hours, 0);

  return (
    <Card title="Jam live yang disetujui, 14 hari terakhir" description={total > 0 ? `Total ${formatDuration(total)} dari semua brand.` : undefined}>
      {total > 0 ? <HoursChart days={days} /> : <p className="text-sm text-muted">Belum ada jam yang disetujui dalam 14 hari terakhir.</p>}
    </Card>
  );
}

function People({ people }: { people: AdminDashboard["people"] }) {
  const items = [
    { label: "Host aktif", value: people.active_hosts, href: "/admin/hosts" },
    { label: "Operator", value: people.operators, href: "/admin/users" },
    { label: "Admin", value: people.admins, href: "/admin/users" },
    { label: `SP sejak ${formatDate(people.points_period.start)}`, value: people.warning_letters, href: "/admin/points" },
  ];

  return (
    <Card title="Orang">
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className="rounded-lg bg-surface-2 border border-stroke p-3 hover:border-stroke-strong">
            <p className="text-xl font-bold text-heading">{item.value}</p>
            <p className="text-xs text-muted mt-0.5">{item.label}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}
