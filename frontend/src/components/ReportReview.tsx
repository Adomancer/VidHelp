"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, FileCheck2, MousePointerClick, Quote, Search, X } from "lucide-react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { errorMessage, reportApi, type Attendance, type ReportCounts, type ReviewReport } from "@/lib/api";
import { compactHours, dayWord, formatClock, formatDateTime, formatDay, formatDuration, toDateInput } from "@/lib/format";
import { FLAG_REASONS, formatMetric, metricLabel } from "@/lib/reportFields";
import { addDays } from "@/lib/schedule";
import { inputClass, inputSmClass } from "@/lib/ui";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import DatePicker from "./DatePicker";
import Dialog from "./Dialog";
import DurationInput from "./DurationInput";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import FormAlert from "./FormAlert";
import { RefreshBar } from "./Loading";
import StatusBadge, { type Tone } from "./StatusBadge";
import { notify } from "./Toast";
import ToggleGroup, { ShortLabel } from "./ToggleGroup";
import UserAvatar from "./UserAvatar";
import { Skeleton } from "./ui/skeleton";

type Tab = "flagged" | "missing" | "approved" | "rejected";
type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

/** A page of either list, tagged so the rows match what loaded (the last tab stays shown while the next one loads). */
type ListPage = { tab: Tab } & (
  (Awaited<ReturnType<typeof reportApi.missing>> & { kind: "missing" }) | (Awaited<ReturnType<typeof reportApi.list>> & { kind: "reports" })
);

const tabLabels: Record<Tab, string> = {
  flagged: "Perlu dicek",
  missing: "Belum masuk",
  approved: "Disetujui",
  rejected: "Ditolak",
};

/** Phones can't fit the full labels on one row, and the tabs shouldn't scroll sideways. */
const shortTabLabels: Record<Tab, string> = {
  flagged: "Dicek",
  missing: "Belum",
  approved: "Setuju",
  rejected: "Tolak",
};

/** Tab, day, search, page and the open report live in the URL, so a refresh or a shared link keeps the view. */
const urlState = {
  tab: parseAsStringLiteral(["flagged", "missing", "approved", "rejected"] as const).withDefault("flagged"),
  date: parseAsString.withDefault(""),
  q: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
  report: parseAsString.withDefault(""),
};

/** The server orders each list; said above it so nobody looks for a sort button. */
const orderNotes: Record<Tab, string> = {
  flagged: "paling lama di atas",
  missing: "terbaru di atas",
  approved: "terbaru di atas",
  rejected: "terbaru di atas",
};

const emptyText: Record<Tab, string> = {
  flagged: "Semua laporan sudah dicek. Laporan baru yang tidak sesuai jadwal muncul di sini.",
  missing: "Semua host sudah mengirim laporannya.",
  approved: "Belum ada laporan yang disetujui.",
  rejected: "Belum ada laporan yang ditolak.",
};

const statusStyles: Record<ReviewReport["status"], { label: string; tone: Tone }> = {
  submitted: { label: "Terkirim", tone: "info" },
  flagged: { label: "Perlu dicek", tone: "warning" },
  approved: { label: "Disetujui", tone: "success" },
  rejected: { label: "Ditolak", tone: "danger" },
};

/** From `lg` the open report shows beside the list; below it opens over the list. */
const SIDE_BY_SIDE = "(min-width: 1024px)";

/**
 * Operator/admin review of live reports that couldn't be auto-approved: a compact list a page at
 * a time (filter by day, find a host or brand) with the open report beside it. Deciding one moves on
 * to the next, and J / K step through the list.
 */
export default function ReportReview({ className }: { className?: string }) {
  const { token } = useAuth();
  const [{ tab, date, q: search, page, report: openId }, setUrlState] = useQueryStates(urlState);
  const [query, setQuery] = useState(search);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sideBySide = useMediaQuery(SIDE_BY_SIDE);
  const invalidate = useInvalidate();

  const filters = { date: date || undefined, search: search || undefined, page };
  // One query for every tab, so the counts in the tabs stay while another tab loads
  const result = useApiData(`reports-${tab}-${JSON.stringify(filters)}`, (): Promise<ListPage> =>
    tab === "missing"
      ? reportApi.missing(token, filters).then((data) => ({ ...data, kind: "missing" as const, tab }))
      : reportApi.list(token, tab, filters).then((data) => ({ ...data, kind: "reports" as const, tab }))
  );
  const data = result.data;
  const reports = useMemo(() => (data?.kind === "reports" ? data.data : []), [data]);
  const open = reports.find((report) => report.id === openId) ?? (sideBySide ? reports[0] : undefined);

  useEffect(() => () => clearTimeout(debounce.current), []);

  // J / K step through the list (not while typing)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const key = event.key.toLowerCase();
      if ((key !== "j" && key !== "k") || reports.length === 0) return;
      const index = open ? reports.indexOf(open) : -1;
      const next = reports[Math.min(reports.length - 1, Math.max(0, index + (key === "j" ? 1 : -1)))];
      if (next) void setUrlState({ report: next.id });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, reports, setUrlState]);

  function selectTab(next: Tab) {
    void setUrlState({ tab: next, page: null, report: null });
  }

  function type(next: string) {
    setQuery(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void setUrlState({ q: next.trim() || null, page: null, report: null }), 300);
  }

  /** Decide on the open report, then open the next one (the decided one leaves the queue). */
  async function decide(report: ReviewReport, action: () => Promise<{ message: string }>) {
    const index = reports.indexOf(report);
    const next = reports[index + 1] ?? reports[index - 1];
    setError(null);
    try {
      notify({ text: (await action()).message });
      void setUrlState({ report: next?.id ?? null });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    invalidate("reports-");
  }

  const counts = data?.counts;
  const showsReports = data?.kind === "reports";

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <ToggleGroup
          label="Status laporan"
          fill
          options={(Object.keys(tabLabels) as Tab[]).map((value) => ({ value, label: <TabLabel tab={value} counts={counts} /> }))}
          value={tab}
          onChange={selectTab}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <DayFilter value={date} onChange={(next) => void setUrlState({ date: next || null, page: null, report: null })} />
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => type(event.target.value)}
              placeholder="Cari host atau brand…"
              aria-label="Cari host atau brand"
              className={cn(inputClass, "pl-9")}
            />
          </div>
        </div>
      </div>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {result.error && <ErrorState message={result.error} onRetry={result.reload} />}

      <div
        className={cn(
          "grid gap-4 lg:min-h-0 lg:flex-1",
          showsReports && "lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]"
        )}
      >
        {/* The list: scrolls inside its card on laptops, a page at a time */}
        <section className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
          <RefreshBar active={result.loading && Boolean(data)} />
          {data && data.total > 0 && (
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {data.total} {showsReports ? "laporan" : "sesi"} · {orderNotes[data.tab]}
              </span>
              {showsReports && (
                <span className="hidden items-center gap-1 lg:inline-flex" title="Tekan J untuk laporan berikutnya, K untuk sebelumnya">
                  <Kbd>J</Kbd>
                  <Kbd>K</Kbd> pindah
                </span>
              )}
            </div>
          )}

          {!data && !result.error && <ListSkeleton />}
          {data?.total === 0 && (
            <EmptyState
              icon={search ? Search : FileCheck2}
              title={search ? `Tidak ada yang cocok dengan "${search}"` : "Tidak ada data"}
              description={search || date ? "Coba kata lain, tanggal lain, atau kosongkan filternya." : emptyText[data.tab]}
              className="flex-1"
            />
          )}

          {data && data.total > 0 && (
            <ul
              aria-label={`Daftar ${tabLabels[data.tab].toLowerCase()}`}
              className={cn("min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain transition-opacity", result.loading && "opacity-60")}
            >
              {data.kind === "missing"
                ? data.data.map((attendance) => <MissingRow key={attendance.id} attendance={attendance} />)
                : data.data.map((report) => (
                    <ReportRow key={report.id} report={report} active={report.id === open?.id} onOpen={() => void setUrlState({ report: report.id })} />
                  ))}
            </ul>
          )}

          {data && data.last_page > 1 && (
            <Pager
              page={data.current_page}
              lastPage={data.last_page}
              total={data.total}
              perPage={data.per_page}
              onChange={(next) => void setUrlState({ page: next, report: null })}
            />
          )}
        </section>

        {/* The open report beside the list, from lg */}
        {showsReports && (
          <section className="hidden min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs lg:flex dark:shadow-none">
            {open ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  <ReportDetail key={open.id} report={open} />
                </div>
                {open.status === "flagged" && <Decision key={open.id} report={open} onDecide={(action) => decide(open, action)} />}
              </div>
            ) : (
              <EmptyState icon={MousePointerClick} title="Pilih laporan" description="Detailnya muncul di sini." className="flex-1" />
            )}
          </section>
        )}
      </div>

      {/* Below lg the report opens over the list */}
      {!sideBySide && open && openId && (
        <Dialog
          placement="side"
          size="lg"
          onClose={() => void setUrlState({ report: null })}
          title="Laporan live"
          footer={open.status === "flagged" && <Decision key={open.id} report={open} onDecide={(action) => decide(open, action)} bare />}
        >
          <ReportDetail key={open.id} report={open} />
        </Dialog>
      )}
    </div>
  );
}

function TabLabel({ tab, counts }: { tab: Tab; counts?: ReportCounts }) {
  const count = tab === "flagged" || tab === "missing" ? counts?.[tab] : undefined;

  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      <ShortLabel short={shortTabLabels[tab]} full={tabLabels[tab]} />
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[11px] leading-[18px] font-semibold tabular-nums",
            tab === "flagged" ? "bg-warning/15 text-warning" : "bg-destructive/10 text-destructive"
          )}
        >
          {count > 999 ? "999+" : count}
        </span>
      )}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px] font-medium text-body">{children}</kbd>;
}

/** All days, or one session day with a step back and forward. */
function DayFilter({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const today = toDateInput();

  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon" aria-label="Hari sebelumnya" onClick={() => onChange(addDays(value || today, -1))}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <DatePicker
        value={value}
        onChange={onChange}
        clearable
        max={today}
        placeholder="Semua tanggal"
        aria-label="Tanggal sesi"
        className="w-40 flex-1 sm:flex-none"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Hari berikutnya"
        disabled={!value || value >= today}
        onClick={() => onChange(addDays(value, 1))}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Memuat">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex gap-3 px-4 py-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** "1–30 dari 87" with previous / next, at the bottom of the list. */
function Pager({
  page,
  lastPage,
  total,
  perPage,
  onChange,
}: {
  page: number;
  lastPage: number;
  total: number;
  perPage: number;
  onChange: (page: number) => void;
}) {
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);

  return (
    <nav aria-label="Halaman" className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {from}–{to} dari {total}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="max-md:size-10"
          aria-label="Halaman sebelumnya"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="tabular-nums">
          {page} / {lastPage}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="max-md:size-10"
          aria-label="Halaman berikutnya"
          disabled={page >= lastPage}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

/** Reported hours, and how far they are from the schedule. */
function HoursDelta({ reported, scheduled }: { reported: number; scheduled: number }) {
  const diff = Math.round((reported - scheduled) * 60) / 60;

  return (
    <span className="shrink-0 text-xs tabular-nums" title={`Dilaporkan ${formatDuration(reported)}, dijadwalkan ${formatDuration(scheduled)}`}>
      <span className="font-medium text-foreground">{compactHours(reported)}</span>
      {diff !== 0 && <span className={diff > 0 ? "text-warning" : "text-info"}> {diff > 0 ? `+${compactHours(diff)}` : `−${compactHours(-diff)}`}</span>}
    </span>
  );
}

function ReportRow({ report, active, onOpen }: { report: ReviewReport; active: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const attendance = report.attendance;
  const reasons = (report.flag_reasons ?? []).map((reason) => FLAG_REASONS[reason] ?? reason);

  // Keep the open one in sight when J / K or "next" moves past the edge
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        aria-current={active || undefined}
        className={cn(
          "flex w-full gap-3 border-l-2 px-4 py-2.5 text-left transition-colors outline-none focus-visible:bg-muted/60",
          active ? "border-l-primary bg-primary/[0.06]" : "border-l-transparent hover:bg-muted/40"
        )}
      >
        <UserAvatar user={report.host.user} size="size-8 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-foreground">{report.host.user.name}</p>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDay(attendance.scheduled_start_at)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {report.brand.name} · {formatClock(attendance.scheduled_start_at)}–{formatClock(attendance.scheduled_end_at)}
            </p>
            <HoursDelta reported={report.duration_hours} scheduled={report.scheduled_hours} />
          </div>
          {report.status === "flagged" && reasons.length > 0 && <p className="mt-0.5 truncate text-[11px] font-medium text-warning">{reasons.join(" · ")}</p>}
        </div>
      </button>
    </li>
  );
}

/** "40 menit", "3 jam", "2 hari" since a moment. */
function elapsedSince(iso: string, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} menit`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} jam`;
  return `${Math.floor(minutes / 1440)} hari`;
}

function MissingRow({ attendance }: { attendance: Attendance }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {attendance.host && <UserAvatar user={attendance.host.user} size="size-8 text-xs" />}
      <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
        <p className="truncate text-sm">
          <span className="font-medium text-foreground">{attendance.host?.user.name}</span>
          <span className="text-muted-foreground"> · {attendance.brand?.name}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">
          {formatDay(attendance.scheduled_start_at)}, {formatClock(attendance.scheduled_start_at)}–{formatClock(attendance.scheduled_end_at)}
          {" · "}check-in {formatClock(attendance.check_in_at)}
          {attendance.check_out_at ? `–${formatClock(attendance.check_out_at)}` : ", tidak check-out"}
        </p>
      </div>
      <StatusBadge tone="danger" className="shrink-0" title={`Batas ${formatDateTime(attendance.report_due_at)}`}>
        <Clock className="size-3" aria-hidden="true" />
        Lewat {elapsedSince(attendance.report_due_at)}
      </StatusBadge>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The open report                                                     */
/* ------------------------------------------------------------------ */

function ReportDetail({ report }: { report: ReviewReport }) {
  const attendance = report.attendance;
  const status = statusStyles[report.status];
  const reasons = (report.flag_reasons ?? []).map((reason) => FLAG_REASONS[reason] ?? reason);
  const metrics = Object.entries(report.metrics ?? {});

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <UserAvatar user={report.host.user} size="size-10 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-foreground">
            {report.host.user.name}
            {attendance.backup_request_id && <StatusBadge tone="info">Backup</StatusBadge>}
            {attendance.event_claim_id && <StatusBadge tone="warning">Event</StatusBadge>}
            {attendance.late_minutes > 0 && <StatusBadge tone="danger">Telat {attendance.late_minutes} mnt</StatusBadge>}
          </p>
          <p className="text-sm text-body">
            {report.brand.name}
            <span className="text-muted-foreground tabular-nums">
              {" · "}
              {dayWord(attendance.scheduled_start_at)}, {formatClock(attendance.scheduled_start_at)}–{formatClock(attendance.scheduled_end_at)}
            </span>
          </p>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      {reasons.length > 0 && (
        <FormAlert tone="warning">
          <p className="font-medium">{report.status === "flagged" ? "Perlu dicek karena" : "Sempat ditandai karena"}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </FormAlert>
      )}

      <HoursCompare report={report} />

      {metrics.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.map(([key, value]) => (
            <div key={key} className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{metricLabel(key)}</dt>
              <dd className="truncate font-medium text-foreground tabular-nums">{value === null ? "–" : formatMetric(key, value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {report.notes && (
        <p className="flex gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-body">
          <Quote className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
          {report.notes}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Dikirim {formatDateTime(report.submitted_at)}
        {report.status !== "flagged" && (
          <>
            {" · "}
            {report.reviewer ? `${report.status === "approved" ? "Disetujui" : "Ditolak"} oleh ${report.reviewer.name}` : "Disetujui otomatis"}
            {report.reviewed_at && `, ${formatDateTime(report.reviewed_at)}`}
          </>
        )}
      </p>
      {report.review_note && report.status !== "flagged" && <p className="text-sm text-body">&ldquo;{report.review_note}&rdquo;</p>}
    </div>
  );
}

/** Scheduled, checked-in and reported time as bars on one scale, so a gap shows at a glance. */
function HoursCompare({ report }: { report: ReviewReport }) {
  const attendance = report.attendance;
  const rows = [
    {
      label: "Jadwal",
      hours: report.scheduled_hours,
      detail: `${formatClock(attendance.scheduled_start_at)}–${formatClock(attendance.scheduled_end_at)}`,
      fill: "bg-faint",
    },
    {
      label: "Check-in",
      hours: report.attended_hours,
      detail: `${formatClock(attendance.check_in_at)}–${attendance.check_out_at ? formatClock(attendance.check_out_at) : "tidak check-out"}`,
      fill: "bg-info",
    },
    { label: "Laporan", hours: report.duration_hours, detail: `${report.session_count} sesi`, fill: "bg-primary" },
  ];
  const max = Math.max(...rows.map((row) => row.hours ?? 0), 0.01);

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-medium text-muted-foreground">Perbandingan jam</p>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{row.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            {row.hours !== null && <div className={cn("h-full rounded-full", row.fill)} style={{ width: `${(row.hours / max) * 100}%` }} />}
          </div>
          <span className="text-right tabular-nums">
            <span className="font-medium text-foreground">{row.hours === null ? "–" : compactHours(row.hours)}</span>
            <span className="block text-[11px] text-muted-foreground">{row.detail}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Paid time (one tap for the schedule, check-in or report), a note, approve or reject. Stays at the
 * bottom of the pane; `bare` inside a dialog footer, which has its own frame.
 */
function Decision({
  report,
  onDecide,
  bare = false,
}: {
  report: ReviewReport;
  onDecide: (action: () => Promise<{ message: string }>) => Promise<void>;
  bare?: boolean;
}) {
  const { token } = useAuth();
  const [hours, setHours] = useState(Math.min(report.duration_hours, report.scheduled_hours));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const presets = [
    { label: "Jadwal", hours: report.scheduled_hours },
    { label: "Check-in", hours: report.attended_hours },
    { label: "Laporan", hours: report.duration_hours },
  ].filter((preset): preset is { label: string; hours: number } => preset.hours !== null);

  const run: Act = async (action) => {
    setBusy(true);
    await onDecide(action);
    setBusy(false);
  };

  return (
    <div className={cn("space-y-3", bare ? "w-full" : "border-t border-border bg-muted/30 p-4")}>
      <div className="flex flex-wrap items-end gap-3">
        <DurationInput label="Waktu yang dibayar" hours={hours} onChange={setHours} compact />
        <div className="flex flex-wrap gap-1.5 pb-0.5" role="group" aria-label="Pakai waktu dari">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setHours(preset.hours)}
              aria-pressed={hours === preset.hours}
              className={cn(
                "inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-7 md:px-2.5",
                hours === preset.hours ? "border-primary/50 bg-primary/10 text-foreground" : "border-border text-body hover:bg-muted"
              )}
            >
              {preset.label} <span className="text-muted-foreground tabular-nums">{compactHours(preset.hours)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={255}
          placeholder="Catatan (wajib untuk menolak)"
          aria-label="Catatan"
          className={cn(inputSmClass, "sm:flex-1")}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !note.trim()}
            onClick={() => run(() => reportApi.reject(token, report.id, note))}
            className="flex-1 text-destructive hover:text-destructive sm:flex-none"
          >
            <X aria-hidden="true" />
            Tolak
          </Button>
          <Button
            type="button"
            variant="success"
            size="sm"
            disabled={busy}
            onClick={() => run(() => reportApi.approve(token, report.id, { duration_hours: hours, review_note: note || null }))}
            className="flex-1 sm:flex-none"
          >
            <Check aria-hidden="true" />
            Setujui {compactHours(hours)}
          </Button>
        </div>
      </div>
    </div>
  );
}
