"use client";

import { useState } from "react";
import { errorMessage, reportApi, type ReviewReport } from "@/lib/api";
import { formatClock, formatDateTime, formatDuration, formatWindow } from "@/lib/format";
import { FLAG_REASONS, formatMetric, metricLabel } from "@/lib/reportFields";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import DurationInput from "./DurationInput";
import FormAlert from "./FormAlert";
import ToggleGroup from "./ToggleGroup";
import UserAvatar from "./UserAvatar";

type Tab = "flagged" | "missing" | "approved" | "rejected";

const tabs: { value: Tab; label: string }[] = [
  { value: "flagged", label: "Perlu dicek" },
  { value: "missing", label: "Laporan belum masuk" },
  { value: "approved", label: "Disetujui" },
  { value: "rejected", label: "Ditolak" },
];

/**
 * Operator/admin review of live reports that couldn't be auto-approved.
 */
export default function ReportReview() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("flagged");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const reports = useApiData(`reports-${tab}`, () =>
    tab === "missing" ? Promise.resolve({ reports: [], metrics: [] }) : reportApi.list(token, tab)
  );
  const missing = useApiData(`missing-${tab}`, () => (tab === "missing" ? reportApi.missing(token) : Promise.resolve({ attendances: [] })));

  async function act(action: () => Promise<{ message: string }>) {
    setNotice(null);
    try {
      setNotice({ tone: "success", text: (await action()).message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    }
    reports.reload();
  }

  const loading = tab === "missing" ? missing.loading : reports.loading;

  return (
    <div className="space-y-5">
      <ToggleGroup options={tabs} value={tab} onChange={setTab} />

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {(reports.error || missing.error) && <FormAlert tone="error">{reports.error ?? missing.error}</FormAlert>}

      <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
        {tab === "missing" ? (
          <>
            {missing.data?.attendances.length === 0 && <Empty />}
            {missing.data?.attendances.map((attendance) => (
              <Card key={attendance.id}>
                <div className="flex items-center gap-3">
                  {attendance.host && <UserAvatar user={attendance.host.user} size="w-8 h-8" />}
                  <div>
                    <p className="text-heading">
                      {attendance.host?.user.name} · {attendance.brand?.name}
                    </p>
                    <p className="text-sm text-muted">
                      {formatWindow(attendance.scheduled_start_at, attendance.scheduled_end_at)} · batas laporan {formatDateTime(attendance.report_due_at)}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </>
        ) : (
          <>
            {reports.data?.reports.length === 0 && <Empty />}
            {reports.data?.reports.map((report) => (
              <ReportCard key={report.id} report={report} act={act} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <Card>
      <p className="text-sm text-muted">Tidak ada data.</p>
    </Card>
  );
}

function ReportCard({ report, act }: { report: ReviewReport; act: (action: () => Promise<{ message: string }>) => Promise<void> }) {
  const { token } = useAuth();
  const [hours, setHours] = useState(Math.min(report.duration_hours, report.scheduled_hours));
  const [note, setNote] = useState("");
  const attendance = report.attendance;
  const input = "px-3 py-2 rounded-lg bg-surface-2 border border-stroke-strong text-heading text-sm";

  return (
    <Card>
      <div className="flex items-start gap-3">
        <UserAvatar user={report.host.user} size="w-9 h-9" />
        <div className="flex-1 min-w-0">
          <p className="text-heading font-medium">
            {report.host.user.name} · {report.brand.name}
            {attendance.backup_request_id && <span className="ml-2 text-xs text-success">backup</span>}
            {attendance.event_claim_id && <span className="ml-2 text-xs text-warning">event</span>}
          </p>
          <p className="text-sm text-accent">{formatWindow(attendance.scheduled_start_at, attendance.scheduled_end_at)}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Dijadwalkan" value={formatDuration(report.scheduled_hours)} />
        <Stat
          label="Check-in"
          value={`${formatClock(attendance.check_in_at)}–${attendance.check_out_at ? formatClock(attendance.check_out_at) : "?"}${report.attended_hours !== null ? ` (${formatDuration(report.attended_hours)})` : ""}`}
        />
        <Stat label="Dilaporkan" value={`${formatDuration(report.duration_hours)} · ${report.session_count} sesi`} />
        {Object.entries(report.metrics ?? {}).map(([key, value]) => (
          <Stat key={key} label={metricLabel(key)} value={value === null ? "—" : formatMetric(key, value)} />
        ))}
      </dl>

      {report.notes && <p className="text-sm text-body">“{report.notes}”</p>}

      {(report.flag_reasons ?? []).length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {report.flag_reasons!.map((reason) => (
            <li key={reason} className="px-2 py-0.5 rounded-md bg-yellow-500/15 text-warning text-xs">
              {FLAG_REASONS[reason] ?? reason}
            </li>
          ))}
        </ul>
      )}

      {report.status === "flagged" ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-stroke pt-3">
          <DurationInput label="Waktu yang dibayar" hours={hours} onChange={setHours} compact />
          <label className="flex-1 min-w-40 space-y-1">
            <span className="block text-xs text-muted">Catatan (wajib untuk menolak)</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={255} className={`${input} w-full`} />
          </label>
          <button
            type="button"
            onClick={() => act(() => reportApi.approve(token, report.id, { duration_hours: hours, review_note: note || null }))}
            className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm hover:bg-green-500"
          >
            Setujui
          </button>
          <button
            type="button"
            disabled={!note.trim()}
            onClick={() => act(() => reportApi.reject(token, report.id, note))}
            className="px-4 py-2 rounded-lg border border-red-400/40 text-danger text-sm hover:bg-red-500/10 disabled:opacity-40"
          >
            Tolak
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">
          {report.reviewer ? `${report.status === "approved" ? "Disetujui" : "Ditolak"} oleh ${report.reviewer.name}` : "Disetujui otomatis"}
          {report.reviewed_at && ` · ${formatDateTime(report.reviewed_at)}`}
          {report.review_note && ` · “${report.review_note}”`}
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-heading">{value}</dd>
    </div>
  );
}
