"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, Clock, LogIn, LogOut, Radio, RefreshCw } from "lucide-react";
import { checkInOpensAt, errorMessage, liveApi, settingsApi, type Attendance, type LiveReport, type LiveSession, type ReportInput } from "@/lib/api";
import { formatClock, formatDateTime, formatFullDay, formatWindow } from "@/lib/format";
import { FLAG_REASONS, metricLabel, METRIC_LABELS } from "@/lib/reportFields";
import { textareaClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { timeUntil, useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { KnowledgeButton } from "@/components/BrandKnowledge";
import Card from "@/components/Card";
import DurationInput from "@/components/DurationInput";
import EmptyState from "@/components/EmptyState";
import { FieldError } from "@/components/FieldMessage";
import ErrorState from "@/components/ErrorState";
import FormAlert from "@/components/FormAlert";
import { CardsSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import StatusBadge, { type Tone } from "@/components/StatusBadge";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

export default function HostLivePage() {
  const { token } = useAuth();
  const live = useApiData("live-today", () => liveApi.today(token));
  const [error, setError] = useState<string | null>(null);

  async function act(action: () => Promise<{ message: string }>) {
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    live.reload();
  }

  const sessions = live.data?.sessions ?? [];
  const missing = live.data?.missing_reports ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live"
        description={formatFullDay(new Date(), false)}
        actions={
          <Button type="button" variant="outline" onClick={live.reload} disabled={live.loading}>
            <RefreshCw className={cn(live.loading && "animate-spin")} aria-hidden="true" />
            Segarkan
          </Button>
        }
      />

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {live.error && <ErrorState message={live.error} onRetry={live.reload} />}
      {!live.data && !live.error && <CardsSkeleton count={2} className="lg:max-w-2xl" />}

      {live.data && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 space-y-6">
            <CurrentSessions sessions={sessions} metrics={live.data.metrics} act={act} />

            {missing.length > 0 && (
              <Card title="Laporan yang belum kamu kirim" description="Sudah lewat batas waktunya. Tetap kirim supaya jam live-mu bisa dicek.">
                <div className="divide-y divide-border">
                  {missing.map((attendance) => (
                    <div key={attendance.id} className="space-y-4 py-5 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {attendance.brand?.name}
                          <span className="font-normal text-muted-foreground"> · {formatWindow(attendance.scheduled_start_at, attendance.scheduled_end_at)}</span>
                        </p>
                        <StatusBadge tone="danger">Terlambat</StatusBadge>
                      </div>
                      <ReportForm attendance={attendance} metrics={live.data!.metrics} act={act} />
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <TodayTimeline sessions={sessions} />
        </div>
      )}
    </div>
  );
}

/** Event blocks have no weekly slot, so they are keyed by their claim. */
/**
 * The sessions still to act on: not over yet, or report missing / flagged for fixing. The clock ticks
 * here (and in the timeline), so report forms elsewhere on the page don't re-render with it.
 */
function CurrentSessions({ sessions, metrics, act }: { sessions: LiveSession[]; metrics: string[]; act: Act }) {
  const now = useNow();
  const current = sessions.filter(
    (session) =>
      new Date(session.end_at) > now ||
      (session.attendance && (!session.attendance.report || session.attendance.report.status === "flagged"))
  );

  if (current.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Radio}
          title="Tidak ada sesi saat ini"
          description="Sesi live berikutnya ada di jadwalmu."
          action={
            <Button asChild variant="outline">
              <Link href="/host/schedule">
                <CalendarDays aria-hidden="true" />
                Lihat jadwal
              </Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return current.map((session) => <SessionCard key={sessionKey(session)} session={session} metrics={metrics} act={act} now={now} />);
}

function sessionKey(session: LiveSession): string {
  return session.event_claim_id ?? `${session.slot_id}|${session.date}|${session.role}`;
}

/** Where a session stands right now, as a badge. */
function sessionState(session: LiveSession, now: Date): { label: string; tone: Tone; pulse?: boolean } {
  const attendance = session.attendance;
  const started = new Date(session.start_at) <= now;
  const ended = new Date(session.end_at) <= now;

  if (session.role === "off") return { label: "Libur", tone: "neutral" };
  if (!attendance) {
    if (ended) return { label: "Tidak check-in", tone: "danger" };
    return started ? { label: "Belum check-in", tone: "warning" } : { label: "Akan datang", tone: "neutral" };
  }
  if (!attendance.check_out_at && !ended) return { label: "Sedang live", tone: "success", pulse: true };
  return reportState(attendance.report ?? null);
}

function reportState(report: LiveReport | null): { label: string; tone: Tone } {
  if (!report) return { label: "Perlu laporan", tone: "warning" };
  const states: Record<LiveReport["status"], { label: string; tone: Tone }> = {
    submitted: { label: "Laporan terkirim", tone: "info" },
    flagged: { label: "Sedang dicek", tone: "warning" },
    approved: { label: "Disetujui", tone: "success" },
    rejected: { label: "Ditolak", tone: "danger" },
  };
  return states[report.status];
}

function SessionCard({ session, metrics, act, now }: { session: LiveSession; metrics: string[]; act: Act; now: Date }) {
  const { token } = useAuth();
  const settings = useApiData("public-settings", () => settingsApi.public(token)).data?.settings;
  const [busy, setBusy] = useState(false);
  const start = new Date(session.start_at);
  const opensAt = checkInOpensAt(start, settings);
  const ended = new Date(session.end_at) <= now;
  const attendance = session.attendance;
  const state = sessionState(session, now);
  const isLive = state.pulse === true;

  async function run(action: () => Promise<{ message: string }>) {
    setBusy(true);
    await act(action);
    setBusy(false);
  }

  return (
    <Card className={cn(isLive && "border-success/40 ring-1 ring-success/20")}>
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl text-base font-semibold",
            session.role === "off" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-brand"
          )}
          aria-hidden="true"
        >
          {session.brand.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className={cn("truncate text-base font-semibold", session.role === "off" ? "text-muted-foreground" : "text-foreground")}>{session.brand.name}</h2>
            <StatusBadge tone={state.tone} pulse={state.pulse}>
              {state.label}
            </StatusBadge>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
            <Clock className="size-3.5" aria-hidden="true" />
            {formatWindow(session.start_at, session.end_at)}
          </p>
          {session.role === "cover" && <p className="mt-1.5 text-xs font-medium text-info">Backup untuk {session.covered_for}</p>}
          {session.role === "event" && <p className="mt-1.5 text-xs font-medium text-brand">Event: {session.event_name}</p>}
          {session.role === "off" && <p className="mt-1.5 text-xs text-muted-foreground">Kamu libur, digantikan {session.covered_by}</p>}
        </div>
        {session.role !== "off" && <KnowledgeButton brand={session.brand} compact className="shrink-0 sm:hidden" />}
        {session.role !== "off" && <KnowledgeButton brand={session.brand} className="hidden shrink-0 sm:inline-flex" />}
      </div>

      {session.role !== "off" && <Progress attendance={attendance} />}

      {session.role !== "off" &&
        !attendance &&
        (ended ? (
          <FormAlert tone="error">Kamu tidak check-in untuk sesi ini.</FormAlert>
        ) : !opensAt ? null : now < opensAt ? (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/50 px-4 py-3 text-sm">
            <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-body">
              Check-in dibuka pukul <span className="font-medium text-foreground tabular-nums">{formatClock(opensAt.toISOString())}</span>
              <span className="text-muted-foreground"> · {timeUntil(opensAt, now)}</span>
            </p>
          </div>
        ) : (
          <Button type="button" variant="success" size="lg" className="w-full" disabled={busy} onClick={() => run(() => liveApi.checkIn(token, session))}>
            <LogIn aria-hidden="true" />
            {busy ? "Memproses…" : "Check-in sekarang"}
          </Button>
        ))}

      {attendance && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 px-4 py-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Check-in</dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground tabular-nums">
                {formatClock(attendance.check_in_at)}
                {attendance.late_minutes > 0 && <StatusBadge tone="danger">Telat {attendance.late_minutes} mnt</StatusBadge>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Check-out</dt>
              <dd className="font-medium text-foreground tabular-nums">{attendance.check_out_at ? formatClock(attendance.check_out_at) : "Belum"}</dd>
            </div>
          </dl>

          {!attendance.check_out_at && (
            <Button type="button" variant="outline" size="lg" className="w-full" disabled={busy} onClick={() => run(() => liveApi.checkOut(token, attendance.id))}>
              <LogOut aria-hidden="true" />
              {busy ? "Memproses…" : "Check-out"}
            </Button>
          )}

          <ReportSection attendance={attendance} metrics={metrics} act={act} />
        </div>
      )}
    </Card>
  );
}

/** Check-in → report sent → approved, as three steps. */
function Progress({ attendance }: { attendance: Attendance | null }) {
  const report = attendance?.report ?? null;
  const steps = [
    { label: "Check-in", done: Boolean(attendance) },
    { label: "Laporan terkirim", done: Boolean(report) && report?.status !== "flagged" },
    { label: report?.status === "rejected" ? "Ditolak" : "Disetujui", done: report?.status === "approved", failed: report?.status === "rejected" },
  ];
  const currentIndex = steps.findIndex((step) => !step.done);

  return (
    <ol className="flex items-start" aria-label="Langkah sesi">
      {steps.map((step, index) => {
        const current = index === currentIndex;
        return (
          <li key={step.label} className="flex flex-1 flex-col items-center gap-1.5 text-center last:flex-none last:basis-auto first:items-start first:text-left last:items-end last:text-right">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition-colors",
                  step.failed
                    ? "border-destructive bg-destructive text-white"
                    : step.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : current
                        ? "border-primary bg-card text-brand"
                        : "border-border bg-card text-muted-foreground"
                )}
                aria-current={current ? "step" : undefined}
              >
                {step.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : index + 1}
              </span>
              {index < steps.length - 1 && <span className={cn("mx-2 h-0.5 flex-1 rounded-full", step.done ? "bg-primary" : "bg-border")} aria-hidden="true" />}
            </div>
            <span className={cn("text-[11px] leading-tight sm:text-xs", step.done || current ? "font-medium text-foreground" : "text-muted-foreground")}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Shows the report state, and the form while it can still be sent or fixed. */
function ReportSection({ attendance, metrics, act }: { attendance: Attendance; metrics: string[]; act: Act }) {
  const report = attendance.report ?? null;
  const [editing, setEditing] = useState(false);

  if (report?.status === "approved") {
    return <FormAlert tone="success">Laporan disetujui. Jam live ini masuk ke perhitungan gaji.</FormAlert>;
  }

  if (report?.status === "rejected") {
    return <FormAlert tone="error">Laporan ditolak{report.review_note ? `: ${report.review_note}` : "."}</FormAlert>;
  }

  if (report?.status === "submitted" && !editing) {
    return (
      <FormAlert tone="info">
        <p>Laporan terkirim. Operator akan mengeceknya.</p>
        <Button type="button" variant="link" className="mt-1 h-auto p-0 text-info" onClick={() => setEditing(true)}>
          Ubah laporan
        </Button>
      </FormAlert>
    );
  }

  if (report?.status === "flagged" && !editing) {
    return (
      <FormAlert tone="warning">
        <p>Operator akan mengecek: {(report.flag_reasons ?? []).map((reason) => FLAG_REASONS[reason] ?? reason).join(", ")}.</p>
        <Button type="button" variant="link" className="mt-1 h-auto p-0 text-warning" onClick={() => setEditing(true)}>
          Perbaiki dan kirim ulang
        </Button>
      </FormAlert>
    );
  }

  return (
    <div className="space-y-4 border-t border-border pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Laporan live</h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden="true" />
          Batas {formatDateTime(attendance.report_due_at)}
        </p>
      </div>
      <ReportForm attendance={attendance} metrics={metrics} act={act} />
    </div>
  );
}

function ReportForm({ attendance, metrics, act }: { attendance: Attendance; metrics: string[]; act: Act }) {
  const { token } = useAuth();
  const report = attendance.report ?? null;
  const id = (field: string) => `${attendance.id}-${field}`;

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
    (result) => act(async () => result),
    ["duration_hours", "metrics"]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <DurationInput label="Durasi live" hours={hours} onChange={setHours} error={errors.duration_hours} />
        <TextField
          label="Jumlah sesi live"
          id={id("session_count")}
          name="session_count"
          type="number"
          min={1}
          defaultValue={report?.session_count ?? 1}
          error={errors.session_count}
        />
        {metrics.map((key) => (
          <TextField
            key={key}
            label={metricLabel(key)}
            id={id(`metric_${key}`)}
            name={`metric_${key}`}
            type="number"
            min={0}
            step={METRIC_LABELS[key]?.step ?? 1}
            inputMode="numeric"
            placeholder="0"
            defaultValue={report?.metrics?.[key] ?? ""}
            error={errors[`metrics.${key}`]}
          />
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("notes")}>
          Catatan <span className="font-normal text-muted-foreground">(opsional)</span>
        </Label>
        <textarea
          id={id("notes")}
          name="notes"
          rows={3}
          placeholder="Masalah atau gangguan selama live"
          defaultValue={report?.notes ?? ""}
          maxLength={2000}
          aria-invalid={errors.notes ? true : undefined}
          className={textareaClass}
        />
        <FieldError>{errors.notes}</FieldError>
      </div>
      <div className="flex justify-end">
        <SubmitButton loading={loading} className="sm:w-auto">
          {report ? "Kirim ulang laporan" : "Kirim laporan"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** All of today's sessions in time order, with where each one stands. */
function TodayTimeline({ sessions }: { sessions: LiveSession[] }) {
  const now = useNow();
  const ordered = [...sessions].sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <Card title="Hari ini" description={ordered.length > 0 ? `${ordered.length} sesi` : undefined} className="lg:sticky lg:top-20">
      {ordered.length === 0 ? (
        <EmptyState compact icon={CalendarDays} title="Tidak ada sesi hari ini" />
      ) : (
        <ol className="relative space-y-0">
          {ordered.map((session, index) => {
            const state = sessionState(session, now);
            const past = new Date(session.end_at) <= now;
            return (
              <li key={sessionKey(session)} className="relative flex gap-3 pb-5 last:pb-0">
                {index < ordered.length - 1 && <span className="absolute top-5 bottom-0 left-[5px] w-px bg-border" aria-hidden="true" />}
                <span
                  className={cn(
                    "relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-card ring-1",
                    state.pulse ? "bg-success ring-success" : past ? "bg-faint ring-faint" : "bg-card ring-input"
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatClock(session.start_at)}–{formatClock(session.end_at)}
                  </p>
                  <p className={cn("truncate text-sm font-medium", past || session.role === "off" ? "text-muted-foreground" : "text-foreground")}>{session.brand.name}</p>
                  <div className="mt-1">
                    <StatusBadge tone={state.tone} pulse={state.pulse} className="h-5 px-1.5 text-[11px]">
                      {state.label}
                    </StatusBadge>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
