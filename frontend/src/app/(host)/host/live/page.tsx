"use client";

import { useState } from "react";
import { errorMessage, liveApi, type Attendance, type LiveReport, type LiveSession, type ReportInput } from "@/lib/api";
import { formatClock, formatDateTime, formatWindow } from "@/lib/format";
import { FLAG_REASONS, metricLabel, METRIC_LABELS } from "@/lib/reportFields";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import DurationInput from "@/components/DurationInput";
import FormAlert from "@/components/FormAlert";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";

/** Minutes before the start that check-in opens (matches the backend default). */
const CHECK_IN_OPENS_MINUTES = 60;

export default function HostLivePage() {
  const { token } = useAuth();
  const live = useApiData("live", () => liveApi.today(token));
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function act(action: () => Promise<{ message: string }>) {
    setNotice(null);
    try {
      setNotice({ tone: "success", text: (await action()).message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    }
    live.reload();
  }

  const now = new Date();
  const sessions = live.data?.sessions ?? [];
  // Still actionable: not over yet, or report missing / flagged for fixing
  const current = sessions.filter(
    (session) =>
      new Date(session.end_at) > now ||
      (session.attendance && (!session.attendance.report || session.attendance.report.status === "flagged"))
  );
  const done = sessions.filter((session) => !current.includes(session));

  return (
    <div className="max-w-lg space-y-5">
      <h1 className="text-xl font-bold text-heading">Live</h1>

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {live.error && <FormAlert tone="error">{live.error}</FormAlert>}

      {live.data && current.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Tidak ada sesi saat ini. Sesi berikutnya ada di halaman Jadwal.</p>
        </Card>
      )}

      {current.map((session) => (
        <SessionCard key={sessionKey(session)} session={session} metrics={live.data!.metrics} act={act} />
      ))}

      {live.data && live.data.missing_reports.length > 0 && (
        <Card title="Laporan yang belum kamu kirim" description="Laporan ini sudah terlambat; tetap kirim supaya jamnya bisa dicek.">
          <div className="space-y-4">
            {live.data.missing_reports.map((attendance) => (
              <div key={attendance.id} className="space-y-2">
                <p className="text-sm text-heading">
                  {attendance.brand?.name} · {formatWindow(attendance.scheduled_start_at, attendance.scheduled_end_at)}
                </p>
                <ReportForm attendance={attendance} metrics={live.data!.metrics} act={act} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {done.length > 0 && (
        <Card title="Sebelumnya">
          <ul className="space-y-2">
            {done.map((session) => (
              <li key={sessionKey(session)} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-body">
                  {session.brand.name} · {formatWindow(session.start_at, session.end_at)}
                </span>
                <DoneLabel session={session} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

/** Event blocks have no weekly slot, so they are keyed by their claim. */
function sessionKey(session: LiveSession): string {
  return session.event_claim_id ?? `${session.slot_id}|${session.date}|${session.role}`;
}

function DoneLabel({ session }: { session: LiveSession }) {
  if (session.role === "off") return <span className="text-xs text-faint">libur</span>;
  if (!session.attendance) return <span className="text-xs text-danger">tidak check-in</span>;
  return <ReportStatusLabel report={session.attendance.report ?? null} />;
}

function SessionCard({ session, metrics, act }: { session: LiveSession; metrics: string[]; act: Act }) {
  const { token } = useAuth();
  const now = new Date();
  const start = new Date(session.start_at);
  const opensAt = new Date(start.getTime() - CHECK_IN_OPENS_MINUTES * 60_000);
  const ended = new Date(session.end_at) <= now;
  const attendance = session.attendance;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`font-medium ${session.role === "off" ? "text-muted" : "text-heading"}`}>{session.brand.name}</p>
          <p className="text-sm text-accent">{formatWindow(session.start_at, session.end_at)}</p>
          {session.role === "cover" && <p className="text-xs text-success">Backup untuk {session.covered_for}</p>}
          {session.role === "event" && <p className="text-xs text-warning">Event: {session.event_name}</p>}
          {session.role === "off" && <p className="text-xs text-muted">Kamu libur · digantikan {session.covered_by}</p>}
        </div>
        {attendance && <ReportStatusLabel report={attendance.report ?? null} />}
      </div>

      {session.role !== "off" && !attendance && (
        ended ? (
          <p className="text-sm text-danger">Kamu tidak check-in untuk sesi ini.</p>
        ) : now < opensAt ? (
          <p className="text-sm text-muted">Check-in dibuka jam {formatClock(opensAt.toISOString())}.</p>
        ) : (
          <button
            type="button"
            onClick={() => act(() => liveApi.checkIn(token, session))}
            className="w-full py-3 rounded-xl bg-green-600 text-white font-medium hover:bg-green-500"
          >
            Check-in
          </button>
        )
      )}

      {attendance && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Check-in {formatClock(attendance.check_in_at)}
            {attendance.check_out_at ? ` · check-out ${formatClock(attendance.check_out_at)}` : ""}
          </p>

          {!attendance.check_out_at && (
            <button
              type="button"
              onClick={() => act(() => liveApi.checkOut(token, attendance.id))}
              className="w-full py-3 rounded-xl bg-surface-3 text-heading font-medium hover:bg-surface-3"
            >
              Check-out
            </button>
          )}

          <ReportSection attendance={attendance} metrics={metrics} act={act} />
        </div>
      )}
    </Card>
  );
}

function ReportStatusLabel({ report }: { report: LiveReport | null }) {
  if (!report) return <span className="text-xs text-warning whitespace-nowrap">Perlu laporan</span>;

  const styles: Record<LiveReport["status"], [string, string]> = {
    submitted: ["Terkirim", "text-info"],
    flagged: ["Sedang dicek", "text-warning"],
    approved: ["Disetujui ✓", "text-success"],
    rejected: ["Ditolak", "text-danger"],
  };
  const [label, style] = styles[report.status];
  return <span className={`text-xs whitespace-nowrap ${style}`}>{label}</span>;
}

/** Shows the report state, and the form while it can still be sent or fixed. */
function ReportSection({ attendance, metrics, act }: { attendance: Attendance; metrics: string[]; act: Act }) {
  const report = attendance.report ?? null;
  const [editing, setEditing] = useState(false);

  if (report?.status === "approved") return null;

  if (report?.status === "rejected") {
    return <p className="text-sm text-danger">Ditolak{report.review_note ? `: ${report.review_note}` : "."}</p>;
  }

  if (report?.status === "flagged" && !editing) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-warning">Operator akan mengecek: {(report.flag_reasons ?? []).map((reason) => FLAG_REASONS[reason] ?? reason).join(", ")}.</p>
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-accent hover:text-heading">
          Perbaiki dan kirim ulang
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-stroke pt-3">
      <p className="text-sm text-heading mb-2">Laporan live · batas {formatDateTime(attendance.report_due_at)}</p>
      <ReportForm attendance={attendance} metrics={metrics} act={act} />
    </div>
  );
}

function ReportForm({ attendance, metrics, act }: { attendance: Attendance; metrics: string[]; act: Act }) {
  const { token } = useAuth();
  const report = attendance.report ?? null;

  const scheduledHours = (new Date(attendance.scheduled_end_at).getTime() - new Date(attendance.scheduled_start_at).getTime()) / 3_600_000;
  const attendedHours = attendance.check_out_at
    ? (new Date(attendance.check_out_at).getTime() - new Date(attendance.check_in_at).getTime()) / 3_600_000
    : scheduledHours;
  // Suggest the checked-in time (capped at the schedule), to the nearest 5 minutes
  const suggestedHours = Math.round(Math.min(scheduledHours, attendedHours) * 12) / 12;
  const [hours, setHours] = useState(report?.duration_hours ?? suggestedHours);

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => {
      const input: ReportInput = {
        session_count: Number(formValue(data, "session_count")),
        duration_hours: Math.round(hours * 100) / 100,
        metrics: Object.fromEntries(metrics.map((key) => [key, formValue(data, `metric_${key}`) === "" ? null : Number(formValue(data, `metric_${key}`))])),
        notes: formValue(data, "notes") || null,
      };
      return liveApi.report(token, attendance.id, input);
    },
    (result) => act(async () => result)
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <DurationInput label="Durasi live" hours={hours} onChange={setHours} error={errors.duration_hours} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Sesi live" name="session_count" type="number" min={1} defaultValue={report?.session_count ?? 1} error={errors.session_count} />
        {metrics.map((key) => (
          <TextField
            key={key}
            label={metricLabel(key)}
            name={`metric_${key}`}
            type="number"
            min={0}
            step={METRIC_LABELS[key]?.step ?? 1}
            inputMode="numeric"
            defaultValue={report?.metrics?.[key] ?? ""}
            error={errors[`metrics.${key}`]}
          />
        ))}
      </div>
      <div className="space-y-1">
        <label htmlFor={`notes-${attendance.id}`} className="block text-sm font-medium text-body">
          Catatan (masalah, gangguan)
        </label>
        <textarea
          id={`notes-${attendance.id}`}
          name="notes"
          rows={2}
          defaultValue={report?.notes ?? ""}
          className="w-full px-4 py-2.5 rounded-xl bg-surface-2 border border-stroke-strong text-heading outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <SubmitButton loading={loading}>{report ? "Kirim ulang laporan" : "Kirim laporan"}</SubmitButton>
    </form>
  );
}
