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
import SubmitButton from "./SubmitButton";
import UserAvatar from "./UserAvatar";

type Tab = "pending" | "open" | "filled" | "closed";

const tabs: { value: Tab; label: string }[] = [
  { value: "pending", label: "To decide" },
  { value: "open", label: "No applicants yet" },
  { value: "filled", label: "Covered" },
  { value: "closed", label: "History" },
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
        <div className="flex flex-wrap gap-2">
          {tabs.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTab(option.value)}
              className={`px-4 py-2 rounded-lg text-sm ${tab === option.value ? "bg-purple-600 text-white" : "bg-slate-900 text-gray-300 hover:bg-slate-800"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="px-4 py-2 rounded-lg border border-slate-700 text-sm text-gray-200 hover:bg-slate-800"
        >
          Request for a host
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
            <p className="text-sm text-gray-400">Nothing here.</p>
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
          <p className="text-white font-medium">
            {backup.brand.name} · {backup.requester?.user.name}
          </p>
          <p className="text-sm text-purple-200">{formatWindow(backup.start_at, backup.end_at)}</p>
          <p className="text-sm text-gray-300 mt-1">
            {reasonLabels[backup.reason_type]}
            {backup.reason && <span className="text-gray-400"> · {backup.reason}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RequestTypeBadge names={nomineeNames} />
          <BackupStatusBadge status={backup.status} />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        {backup.letter_status !== "not_needed" && (
          <span className="flex items-center gap-2">
            <LetterBadge status={backup.letter_status} />
            {backup.letter_status === "uploaded" && (
              <button type="button" onClick={openLetter} className="text-purple-300 hover:text-white">
                View
              </button>
            )}
          </span>
        )}
        {waiting && (
          <span>
            {backup.applicants_count ?? 0} applied · best applicant approved automatically {formatDateTime(backup.auto_fill_at)}
          </span>
        )}
      </div>
      {letterError && <FormAlert tone="error">{letterError}</FormAlert>}

      {backup.status === "filled" && backup.filler && (
        <div className="flex items-center gap-2 text-sm text-green-300">
          <UserAvatar user={backup.filler.user} size="w-6 h-6" />
          Covered by {backup.filler.user.name}
          {backup.auto_filled && <span className="text-xs text-gray-400">(approved automatically)</span>}
          {backup.counts_toward_quota && <span className="text-xs text-gray-400">· other brand, uses quota</span>}
        </div>
      )}

      {running && (
        <div className="flex flex-wrap gap-2">
          {waiting && (
            <ActionButton primary onClick={() => setChoosing(!choosing)}>
              {choosing ? "Close" : backup.status === "pending" ? "Review applicants" : "Assign a cover"}
            </ActionButton>
          )}
          {backup.status === "filled" && (
            <ActionButton onClick={() => confirm("Remove the cover (no penalty) and reopen?") && act(() => operatorBackupApi.unassign(token, backup.id))}>
              Change cover
            </ActionButton>
          )}
          {["pending", "open", "filled"].includes(backup.status) && (
            <ActionButton onClick={() => confirm("Cancel this backup request entirely?") && act(() => operatorBackupApi.cancel(token, backup.id))}>
              Cancel request
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
      className={`px-3 py-1.5 rounded-lg text-sm ${primary ? "bg-purple-600 text-white hover:bg-purple-500" : "border border-slate-700 text-gray-300 hover:bg-slate-800"}`}
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
    confirm(`Reject ${candidate.name}? If nobody else applied, the request is open again.`) &&
    act(() => operatorBackupApi.rejectApplicant(token, backup.id, candidate.host_id));

  return (
    <div className="space-y-3 border-t border-slate-800 pt-3">
      <p className="text-xs text-gray-400">Applicants, best first (highest rating, then same brand, then who applied earliest):</p>
      {applicants.data?.applicants.length === 0 && <p className="text-sm text-gray-400">Nobody has applied yet.</p>}
      <CandidateList candidates={applicants.data?.applicants ?? []} onPick={pick} onReject={reject} />

      {showEveryone ? (
        <>
          <p className="text-xs text-gray-400">All hosts (for emergencies; they don&apos;t need to have applied or be named):</p>
          <CandidateList candidates={everyone.data?.candidates ?? []} onPick={pick} />
        </>
      ) : (
        <button type="button" onClick={() => setShowEveryone(true)} className="text-sm text-purple-300 hover:text-white">
          Assign someone who didn&apos;t apply…
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
        <li key={candidate.host_id} className="flex items-center gap-3 rounded-lg bg-slate-800/60 px-3 py-2">
          <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="w-7 h-7" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{candidate.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {candidate.rating != null && <span className="text-yellow-200">★ {candidate.rating.toFixed(1)} · </span>}
              {candidate.same_brand ? "Same brand" : `Other brand · quota ${candidate.quota.quota_used}/${candidate.quota.quota_max}`}
              {candidate.ineligible_reason && <span className="text-red-300"> · {candidate.ineligible_reason}</span>}
            </p>
          </div>
          {onReject && (
            <button
              type="button"
              onClick={() => onReject(candidate)}
              className="px-3 py-1 rounded-md border border-slate-600 text-gray-300 text-sm hover:bg-slate-700"
            >
              Reject
            </button>
          )}
          <button
            type="button"
            disabled={!candidate.eligible}
            onClick={() => onPick(candidate)}
            className="px-3 py-1 rounded-md bg-green-600 text-white text-sm hover:bg-green-500 disabled:opacity-30"
          >
            Approve
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

  const input = "w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white";

  return (
    <Card title="Request a backup for a host" description="Opens on the board immediately, also for a session starting soon.">
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <label className="space-y-1">
          <span className="block text-sm text-gray-200">Date</span>
          <input type="date" value={date} min={toDateInput()} onChange={(event) => event.target.value && setDate(event.target.value)} className={input} />
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-gray-200">Session</span>
          <select name="slot_id" className={input} disabled={daySlots.length === 0}>
            {daySlots.length === 0 && <option>No sessions that day</option>}
            {daySlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.assignment.host?.user.name} · {slot.assignment.brand.name} · {formatTimeRange(slot.start_time, slot.end_time, slot.day_of_week)}
              </option>
            ))}
          </select>
          {(errors.slot_id || errors.backup_date) && <span className="block text-sm text-red-300">{errors.slot_id ?? errors.backup_date}</span>}
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-gray-200">Reason</span>
          <select value={reasonType} onChange={(event) => setReasonType(event.target.value as BackupReason)} className={input}>
            {(Object.keys(reasonLabels) as BackupReason[]).map((value) => (
              <option key={value} value={value}>
                {reasonLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-gray-200">Details</span>
          <input name="reason" maxLength={1000} className={input} />
        </label>
        <div className="sm:col-span-2 flex gap-3">
          {daySlots.length > 0 && (
            <div className="w-40">
              <SubmitButton loading={loading}>Open request</SubmitButton>
            </div>
          )}
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-gray-300 hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
