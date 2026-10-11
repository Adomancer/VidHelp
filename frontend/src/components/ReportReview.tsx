"use client";

import { useState } from "react";
import { Check, Clock, FileCheck2, Quote, X } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { errorMessage, reportApi, type ReviewReport } from "@/lib/api";
import { formatClock, formatDateTime, formatDuration, formatWindow } from "@/lib/format";
import { FLAG_REASONS, formatMetric, metricLabel } from "@/lib/reportFields";
import { inputSmClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import DurationInput from "./DurationInput";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import FormAlert from "./FormAlert";
import { CardsSkeleton } from "./Loading";
import StatusBadge from "./StatusBadge";
import { notify } from "./Toast";
import ToggleGroup from "./ToggleGroup";
import UserAvatar from "./UserAvatar";

type Tab = "flagged" | "missing" | "approved" | "rejected";

const tabs: { value: Tab; label: string }[] = [
  { value: "flagged", label: "Perlu dicek" },
  { value: "missing", label: "Laporan belum masuk" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Ditolak" },
];

const emptyText: Record<Tab, string> = {
  flagged: "Semua laporan sudah dicek. Laporan baru yang tidak sesuai jadwal muncul di sini.",
  missing: "Semua host sudah mengirim laporannya.",
  approved: "Belum ada laporan yang disetujui.",
  rejected: "Belum ada laporan yang ditolak.",
};

/**
 * Operator/admin review of live reports that couldn't be auto-approved.
 */
export default function ReportReview() {
  const { token } = useAuth();
  // The tab lives in the URL, so a refresh or the Back button keeps it
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(tabs.map((option) => option.value)).withDefault("flagged"));
  const [error, setError] = useState<string | null>(null);

  const reports = useApiData(`reports-${tab}`, () =>
    tab === "missing" ? Promise.resolve({ reports: [], metrics: [] }) : reportApi.list(token, tab)
  );
  const missing = useApiData(`reports-missing-${tab}`, () => (tab === "missing" ? reportApi.missing(token) : Promise.resolve({ attendances: [] })));

  async function act(action: () => Promise<{ message: string }>) {
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    reports.reload();
  }

  const current = tab === "missing" ? missing : reports;
  const loading = current.loading;
  const items = tab === "missing" ? missing.data?.attendances : reports.data?.reports;

  return (
    <div className="space-y-5">
      <ToggleGroup label="Status laporan" options={tabs} value={tab} onChange={(next) => void setTab(next)} />

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {current.error && <ErrorState message={current.error} onRetry={current.reload} />}
      {!current.data && !current.error && <CardsSkeleton count={2} />}

      {items?.length === 0 && (
        <div className="rounded-xl border border-dashed border-input bg-card/50">
          <EmptyState icon={FileCheck2} title="Tidak ada data" description={emptyText[tab]} />
        </div>
      )}

      <ul className={cn("space-y-3 transition-opacity", loading && items && "opacity-60")}>
        {tab === "missing"
          ? missing.data?.attendances.map((attendance) => (
              <li key={attendance.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-xs dark:shadow-none">
                {attendance.host && <UserAvatar user={attendance.host.user} size="size-9 text-sm" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {attendance.host?.user.name}
                    <span className="font-normal text-muted-foreground"> · {attendance.brand?.name}</span>
                  </p>
                  <p className="text-sm text-muted-foreground tabular-nums">{formatWindow(attendance.scheduled_start_at, attendance.scheduled_end_at)}</p>
                </div>
                <StatusBadge tone="danger" className="hidden sm:inline-flex">
                  <Clock className="size-3" aria-hidden="true" />
                  Batas {formatDateTime(attendance.report_due_at)}
                </StatusBadge>
              </li>
            ))
          : reports.data?.reports.map((report) => <ReportCard key={report.id} report={report} act={act} />)}
      </ul>
    </div>
  );
}

function ReportCard({ report, act }: { report: ReviewReport; act: (action: () => Promise<{ message: string }>) => Promise<void> }) {
  const { token } = useAuth();
  const [hours, setHours] = useState(Math.min(report.duration_hours, report.scheduled_hours));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const attendance = report.attendance;

  async function run(action: () => Promise<{ message: string }>) {
    setBusy(true);
    await act(action);
    setBusy(false);
  }

  return (
    <li className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs dark:shadow-none">
      <div className="flex items-start gap-3">
        <UserAvatar user={report.host.user} size="size-10 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
            {report.host.user.name}
            <span className="font-normal text-muted-foreground">· {report.brand.name}</span>
            {attendance.backup_request_id && <StatusBadge tone="info">Backup</StatusBadge>}
            {attendance.event_claim_id && <StatusBadge tone="warning">Event</StatusBadge>}
          </p>
          <p className="text-sm text-body tabular-nums">{formatWindow(attendance.scheduled_start_at, attendance.scheduled_end_at)}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/50 px-4 py-3 text-sm sm:grid-cols-4">
        <Stat label="Dijadwalkan" value={formatDuration(report.scheduled_hours)} />
        <Stat
          label="Check-in"
          value={`${formatClock(attendance.check_in_at)}–${attendance.check_out_at ? formatClock(attendance.check_out_at) : "?"}${report.attended_hours !== null ? ` (${formatDuration(report.attended_hours)})` : ""}`}
        />
        <Stat label="Dilaporkan" value={`${formatDuration(report.duration_hours)} · ${report.session_count} sesi`} />
        {Object.entries(report.metrics ?? {}).map(([key, value]) => (
          <Stat key={key} label={metricLabel(key)} value={value === null ? "–" : formatMetric(key, value)} />
        ))}
      </dl>

      {report.notes && (
        <p className="flex gap-2 text-sm text-body">
          <Quote className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
          {report.notes}
        </p>
      )}

      {(report.flag_reasons ?? []).length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {report.flag_reasons!.map((reason) => (
            <li key={reason}>
              <StatusBadge tone="warning">{FLAG_REASONS[reason] ?? reason}</StatusBadge>
            </li>
          ))}
        </ul>
      )}

      {report.status === "flagged" ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <DurationInput label="Waktu yang dibayar" hours={hours} onChange={setHours} compact />
          <label className="min-w-48 flex-1 space-y-1">
            <span className="block text-xs text-muted-foreground">Catatan (wajib untuk menolak)</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} className={inputSmClass} />
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy || !note.trim()} onClick={() => run(() => reportApi.reject(token, report.id, note))} className="text-destructive hover:text-destructive">
              <X aria-hidden="true" />
              Tolak
            </Button>
            <Button
              type="button"
              variant="success"
              size="sm"
              disabled={busy}
              onClick={() => run(() => reportApi.approve(token, report.id, { duration_hours: hours, review_note: note || null }))}
            >
              <Check aria-hidden="true" />
              Setujui
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          {report.reviewer ? `${report.status === "approved" ? "Disetujui" : "Ditolak"} oleh ${report.reviewer.name}` : "Disetujui otomatis"}
          {report.reviewed_at && ` · ${formatDateTime(report.reviewed_at)}`}
          {report.review_note && ` · "${report.review_note}"`}
        </p>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}
