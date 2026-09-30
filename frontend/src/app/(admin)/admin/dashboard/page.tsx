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
  { key: "pending_signups", label: "Sign-ups to approve", href: "/admin/users" },
  { key: "backups_pending", label: "Backup requests to approve", href: "/admin/backups" },
  { key: "backups_uncovered_soon", label: "Backups with no cover, starting within 24 h", href: "/admin/backups" },
  { key: "reports_flagged", label: "Flagged live reports", href: "/admin/reports" },
  { key: "reports_missing", label: "Live reports overdue", href: "/admin/reports" },
  { key: "periods_to_request", label: "Pay periods ready to request", href: "/admin/payroll" },
  { key: "periods_awaiting_brand", label: "Pay periods waiting for the brand", href: "/admin/payroll" },
];

const stateStyles: Record<SessionState, { label: string; className: string; dot: string }> = {
  live: { label: "Live now", className: "bg-green-500/15 text-green-300", dot: "bg-green-400" },
  late: { label: "Not checked in", className: "bg-yellow-500/15 text-yellow-200", dot: "bg-yellow-300" },
  missed: { label: "Missed", className: "bg-red-500/15 text-red-300", dot: "bg-red-400" },
  done: { label: "Done", className: "bg-slate-700 text-gray-300", dot: "bg-gray-400" },
  upcoming: { label: "Upcoming", className: "bg-slate-800 text-gray-400", dot: "bg-gray-600" },
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
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {dashboard.error && <FormAlert tone="error">{dashboard.error}</FormAlert>}
      {!data && !dashboard.error && <p className="text-gray-400">Loading…</p>}

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
      <h2 className="text-white font-medium">Needs attention</h2>
      {waiting.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-sm text-gray-300">
          <span className="text-green-300">✓</span> Nothing is waiting on you.
        </p>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {waiting.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="rounded-xl border border-yellow-400/30 bg-slate-900 p-4 hover:border-yellow-300/60 hover:bg-slate-800/60 transition-colors"
            >
              <p className="text-2xl font-bold text-white">{attention[item.key]}</p>
              <p className="text-sm text-gray-300 mt-1">{item.label}</p>
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
    <Card title="Today's sessions">
      {sessions.length === 0 ? (
        <p className="text-sm text-gray-400">No sessions scheduled today.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {stateOrder
              .filter((state) => counts[state])
              .map((state) => (
                <span key={state} className="text-sm text-gray-300">
                  <StateBadge state={state} /> <span className="text-white font-medium">{counts[state]}</span>
                </span>
              ))}
          </div>
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-400 border-b border-slate-800">
                <tr>
                  <th className="px-5 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Host</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sessions.map((session) => (
                  <tr key={`${session.host.id}-${session.start_at}`} className="text-gray-200">
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      {formatClock(session.start_at)}–{formatClock(session.end_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-white">{session.host.name}</span>
                      {session.role === "cover" && session.covered_for && (
                        <span className="block text-xs text-gray-400">covering {session.covered_for}</span>
                      )}
                      {session.role === "event" && session.event_name && (
                        <span className="block text-xs text-gray-400">event: {session.event_name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-300">{session.brand.name}</td>
                    <td className="px-5 py-2.5">
                      <StateBadge state={session.state} />
                      {session.check_in_at && session.state === "live" && (
                        <span className="ml-2 text-xs text-gray-400">since {formatClock(session.check_in_at)}</span>
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
    <Card title="Brands this pay period" description="Approved hours against each brand's target. Host pay is an estimate at current rates until payment is requested.">
      {brands.length === 0 ? (
        <p className="text-sm text-gray-400">No active brands yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400 border-b border-slate-800">
              <tr>
                <th className="px-5 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium min-w-48">Hours vs target</th>
                <th className="px-3 py-2 font-medium text-right">GMV reported</th>
                <th className="px-5 py-2 font-medium text-right">Host pay (est.)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
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
      <tr className="text-gray-200">
        <td className="px-5 py-3 text-white">{brand.name}</td>
        <td colSpan={4} className="px-3 py-3 text-gray-400">
          No payroll start date yet.{" "}
          <Link href="/admin/brands" className="text-purple-300 hover:text-white">
            Set it on Brands
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
    <tr className="text-gray-200 align-top">
      <td className="px-5 py-3 text-white">{brand.name}</td>
      <td className="px-3 py-3 whitespace-nowrap">
        {formatShortDate(brand.period.start)} – {formatShortDate(brand.period.end)}
        <span className="block text-xs text-gray-400">
          {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "ended"}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-white">{formatDuration(achieved)}</span>
          <span className="text-xs text-gray-400">of {formatDuration(target)}</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-slate-800" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${brand.name} hours`}>
          <div className="h-full rounded-full bg-purple-500" style={{ width: `${percent}%` }} />
        </div>
        {(brand.carried_in_hours ?? 0) > 0 && (
          <span className="block text-xs text-gray-400 mt-1">incl. {formatDuration(brand.carried_in_hours ?? 0)} carried in</span>
        )}
        {(brand.carried_out_hours ?? 0) > 0 && (
          <span className="block text-xs text-gray-400 mt-1">{formatDuration(brand.carried_out_hours ?? 0)} over target, carries to next period</span>
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
    <Card title="Approved live hours, last 14 days" description={total > 0 ? `${formatDuration(total)} in total across all brands.` : undefined}>
      {total > 0 ? <HoursChart days={days} /> : <p className="text-sm text-gray-400">No approved hours in the last 14 days.</p>}
    </Card>
  );
}

function People({ people }: { people: AdminDashboard["people"] }) {
  const items = [
    { label: "Active hosts", value: people.active_hosts, href: "/admin/hosts" },
    { label: "Operators", value: people.operators, href: "/admin/users" },
    { label: "Admins", value: people.admins, href: "/admin/users" },
    { label: `SPs since ${formatDate(people.points_period.start)}`, value: people.warning_letters, href: "/admin/points" },
  ];

  return (
    <Card title="People">
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className="rounded-lg bg-slate-950/60 border border-slate-800 p-3 hover:border-slate-700">
            <p className="text-xl font-bold text-white">{item.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{item.label}</p>
          </Link>
        ))}
      </div>
    </Card>
  );
}
