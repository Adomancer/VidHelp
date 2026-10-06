"use client";

import { useState } from "react";
import {
  errorMessage,
  operatorBackupApi,
  scheduleApi,
  type BackupCandidate,
  type BackupReason,
  type BackupRequest,
} from "@/lib/api";
import { formatDateTime, formatTimeRange, formatWindow, isoWeekday, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import { BackupStatusBadge, LetterBadge, reasonLabels, RequestTypeBadge } from "./BackupBadges";
import Card from "./Card";
import FormAlert from "./FormAlert";
import Modal from "./Modal";
import SubmitButton from "./SubmitButton";
import ToggleGroup from "./ToggleGroup";
import UserAvatar from "./UserAvatar";

type Tab = "pending" | "open" | "filled" | "closed";

const tabs: { value: Tab; label: string }[] = [
  { value: "pending", label: "Perlu diputuskan" },
  { value: "open", label: "Belum ada pendaftar" },
  { value: "filled", label: "Sudah ada pengganti" },
  { value: "closed", label: "Riwayat" },
];

/**
 * Admin/operator backup desk: approve or reject applicants, assign covers in emergencies.
 */
export default function BackupDesk() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("pending");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const requests = useApiData(tab, () => operatorBackupApi.list(token, tab));

  async function act(action: () => Promise<{ message: string }>) {
    setNotice(null);
    try {
      setNotice({ tone: "success", text: (await action()).message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    }
    requests.reload();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup options={tabs} value={tab} onChange={setTab} />
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded-lg border border-stroke-strong text-sm text-body hover:bg-surface-2"
        >
          Ajukan untuk host
        </button>
      </div>

      {creating && (
        <OnBehalfForm
          onDone={(message) => {
            setCreating(false);
            setNotice({ tone: "success", text: message });
            setTab("open");
            requests.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {requests.error && <FormAlert tone="error">{requests.error}</FormAlert>}

      <div className={`space-y-3 ${requests.loading ? "opacity-60" : ""}`}>
        {requests.data?.requests.length === 0 && (
          <Card>
            <p className="text-sm text-muted">Tidak ada data.</p>
          </Card>
        )}
        {requests.data?.requests.map((backup) => (
          <RequestCard key={backup.id} backup={backup} act={act} />
        ))}
      </div>
    </div>
  );
}

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

function RequestCard({ backup, act }: { backup: BackupRequest; act: Act }) {
  const { token } = useAuth();
  const [choosing, setChoosing] = useState(false);
  const [letterError, setLetterError] = useState<string | null>(null);
  const running = new Date(backup.end_at) > new Date();
  const waiting = backup.status === "open" || backup.status === "pending";
  const nomineeNames = backup.nominees?.map((nominee) => nominee.host.user.name) ?? [];

  async function openLetter() {
    // Open the tab during the click (popup blockers), then point it at the downloaded file
    const tab = window.open("", "_blank");
    try {
      const url = await operatorBackupApi.letterUrl(token, backup.id);
      if (tab) tab.location.href = url;
    } catch (caught) {
      tab?.close();
      setLetterError(errorMessage(caught));
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-heading font-medium">
            {backup.brand.name} · {backup.requester?.user.name}
          </p>
          <p className="text-sm text-accent">{formatWindow(backup.start_at, backup.end_at)}</p>
          <p className="text-sm text-body mt-1">
            {reasonLabels[backup.reason_type]}
            {backup.reason && <span className="text-muted"> · {backup.reason}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RequestTypeBadge names={nomineeNames} />
          <BackupStatusBadge status={backup.status} />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {backup.letter_status !== "not_needed" && (
          <span className="flex items-center gap-2">
            <LetterBadge status={backup.letter_status} />
            {backup.letter_status === "uploaded" && (
              <button type="button" onClick={openLetter} className="text-accent hover:text-heading">
                Lihat
              </button>
            )}
          </span>
        )}
        {waiting && (
          <span>
            {backup.applicants_count ?? 0} mendaftar · pendaftar terbaik disetujui otomatis {formatDateTime(backup.auto_fill_at)}
          </span>
        )}
      </div>
      {letterError && <FormAlert tone="error">{letterError}</FormAlert>}

      {backup.status === "filled" && backup.filler && (
        <div className="flex items-center gap-2 text-sm text-success">
          <UserAvatar user={backup.filler.user} size="w-6 h-6" />
          Digantikan {backup.filler.user.name}
          {backup.auto_filled && <span className="text-xs text-muted">(disetujui otomatis)</span>}
          {backup.counts_toward_quota && <span className="text-xs text-muted">· brand lain, memakai kuota</span>}
        </div>
      )}

      {running && (
        <div className="flex flex-wrap gap-2">
          {waiting && (
            <ActionButton primary onClick={() => setChoosing(!choosing)}>
              {choosing ? "Tutup" : backup.status === "pending" ? "Cek pendaftar" : "Tunjuk pengganti"}
            </ActionButton>
          )}
          {backup.status === "filled" && (
            <ActionButton onClick={() => confirm("Lepas pengganti (tanpa penalti) dan buka lagi?") && act(() => operatorBackupApi.unassign(token, backup.id))}>
              Ganti pengganti
            </ActionButton>
          )}
          {["pending", "open", "filled"].includes(backup.status) && (
            <ActionButton onClick={() => confirm("Batalkan seluruh permintaan backup ini?") && act(() => operatorBackupApi.cancel(token, backup.id))}>
              Batalkan permintaan
            </ActionButton>
          )}
        </div>
      )}

      {choosing && waiting && <CoverPicker backup={backup} act={act} />}
    </Card>
  );
}

function ActionButton({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm ${primary ? "bg-primary text-white hover:bg-primary-hover" : "border border-stroke-strong text-body hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}

/** Applicants (ranked) plus, on demand, every other host for emergencies. */
function CoverPicker({ backup, act }: { backup: BackupRequest; act: Act }) {
  const { token } = useAuth();
  const [showEveryone, setShowEveryone] = useState(false);
  const applicants = useApiData(`applicants-${backup.id}`, () => operatorBackupApi.applicants(token, backup.id));
  const everyone = useApiData(`candidates-${backup.id}-${showEveryone}`, () =>
    showEveryone ? operatorBackupApi.candidates(token, backup.id) : Promise.resolve({ candidates: [] })
  );

  const pick = (candidate: BackupCandidate) => act(() => operatorBackupApi.assign(token, backup.id, candidate.host_id));
  const reject = (candidate: BackupCandidate) =>
    confirm(`Tolak ${candidate.name}? Kalau tidak ada pendaftar lain, permintaan dibuka lagi.`) &&
    act(() => operatorBackupApi.rejectApplicant(token, backup.id, candidate.host_id));

  return (
    <div className="space-y-3 border-t border-stroke pt-3">
      <p className="text-xs text-muted">Pendaftar, terbaik di atas (rating tertinggi, lalu brand yang sama, lalu yang mendaftar paling awal):</p>
      {applicants.data?.applicants.length === 0 && <p className="text-sm text-muted">Belum ada yang mendaftar.</p>}
      <CandidateList candidates={applicants.data?.applicants ?? []} onPick={pick} onReject={reject} />

      {showEveryone ? (
        <>
          <p className="text-xs text-muted">Semua host (untuk darurat; tidak harus sudah mendaftar atau diminta):</p>
          <CandidateList candidates={everyone.data?.candidates ?? []} onPick={pick} />
        </>
      ) : (
        <button type="button" onClick={() => setShowEveryone(true)} className="text-sm text-accent hover:text-heading">
          Tunjuk host yang tidak mendaftar…
        </button>
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  onPick,
  onReject,
}: {
  candidates: BackupCandidate[];
  onPick: (candidate: BackupCandidate) => void;
  /** Only for applicants */
  onReject?: (candidate: BackupCandidate) => void;
}) {
  return (
    <ul className="space-y-2">
      {candidates.map((candidate) => (
        <li key={candidate.host_id} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="w-7 h-7" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-heading truncate">{candidate.name}</p>
            <p className="text-xs text-muted truncate">
              {candidate.rating != null && <span className="text-warning">★ {candidate.rating.toFixed(1)} · </span>}
              {candidate.same_brand ? "Brand yang sama" : `Brand lain · kuota ${candidate.quota.quota_used}/${candidate.quota.quota_max}`}
              {candidate.ineligible_reason && <span className="text-danger"> · {candidate.ineligible_reason}</span>}
            </p>
          </div>
          {onReject && (
            <button
              type="button"
              onClick={() => onReject(candidate)}
              className="px-3 py-1 rounded-md border border-stroke-strong text-body text-sm hover:bg-surface-3"
            >
              Tolak
            </button>
          )}
          <button
            type="button"
            disabled={!candidate.eligible}
            onClick={() => onPick(candidate)}
            className="px-3 py-1 rounded-md bg-green-600 text-white text-sm hover:bg-green-500 disabled:opacity-30"
          >
            Setujui
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Emergency: open a request for a host who called in, e.g. by phone. */
function OnBehalfForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const [date, setDate] = useState(toDateInput());
  const [reasonType, setReasonType] = useState<BackupReason>("sick");
  const slots = useApiData(`slots-on-${date}`, () => scheduleApi.list(token, { on: date }));
  const weekday = isoWeekday(new Date(`${date}T00:00`));
  const daySlots = slots.data?.slots.filter((slot) => slot.day_of_week === weekday) ?? [];

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      operatorBackupApi.create(token, {
        slot_id: formValue(data, "slot_id"),
        backup_date: date,
        reason_type: reasonType,
        reason: formValue(data, "reason") || null,
      }),
    ({ message }) => onDone(message)
  );

  const input = "w-full px-3 py-2 rounded-lg bg-surface-2 border border-stroke-strong text-heading";

  return (
    <Modal title="Ajukan backup untuk host" description="Langsung muncul di papan backup, juga untuk sesi yang akan segera mulai." onClose={onCancel}>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <label className="space-y-1">
          <span className="block text-sm text-body">Tanggal</span>
          <input type="date" value={date} min={toDateInput()} onChange={(event) => event.target.value && setDate(event.target.value)} className={input} />
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-body">Sesi</span>
          <select name="slot_id" className={input} disabled={daySlots.length === 0}>
            {daySlots.length === 0 && <option>Tidak ada sesi di hari itu</option>}
            {daySlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.assignment.host?.user.name} · {slot.assignment.brand.name} · {formatTimeRange(slot.start_time, slot.end_time, slot.day_of_week)}
              </option>
            ))}
          </select>
          {(errors.slot_id || errors.backup_date) && <span className="block text-sm text-danger">{errors.slot_id ?? errors.backup_date}</span>}
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-body">Alasan</span>
          <select value={reasonType} onChange={(event) => setReasonType(event.target.value as BackupReason)} className={input}>
            {(Object.keys(reasonLabels) as BackupReason[]).map((value) => (
              <option key={value} value={value}>
                {reasonLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-body">Keterangan</span>
          <input name="reason" maxLength={1000} className={input} />
        </label>
        <div className="sm:col-span-2 flex gap-3">
          {daySlots.length > 0 && (
            <div className="w-40">
              <SubmitButton loading={loading}>Buka permintaan</SubmitButton>
            </div>
          )}
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-body hover:bg-surface-2">
            Batal
          </button>
        </div>
      </form>
    </Modal>
  );
}
