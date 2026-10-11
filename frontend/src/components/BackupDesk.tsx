"use client";

import { useState } from "react";
import { ChevronDown, Clock, ExternalLink, Inbox, Plus, Star, UserRoundPlus } from "lucide-react";
import {
  errorMessage,
  operatorBackupApi,
  scheduleApi,
  type BackupCandidate,
  type BackupReason,
  type BackupRequest,
} from "@/lib/api";
import { formatDateTime, formatTimeRange, formatWindow, isoWeekday, toDateInput } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import { BackupStatusBadge, LetterBadge, reasonLabels, RequestTypeBadge } from "./BackupBadges";
import ConfirmDialog from "./ConfirmDialog";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import { FieldError } from "./FieldMessage";
import FormActions from "./FormActions";
import FormAlert from "./FormAlert";
import { CardsSkeleton, ListSkeleton } from "./Loading";
import Modal from "./Modal";
import { NativeSelect } from "./SelectField";
import { notify } from "./Toast";
import ToggleGroup from "./ToggleGroup";
import UserAvatar from "./UserAvatar";

type Tab = "pending" | "open" | "filled" | "closed";

const tabs: { value: Tab; label: string }[] = [
  { value: "pending", label: "Perlu diputuskan" },
  { value: "open", label: "Belum ada pendaftar" },
  { value: "filled", label: "Sudah ada pengganti" },
  { value: "closed", label: "Riwayat" },
];

const emptyText: Record<Tab, string> = {
  pending: "Tidak ada pendaftar yang menunggu keputusan.",
  open: "Semua permintaan sudah ada pendaftarnya.",
  filled: "Belum ada backup yang terisi.",
  closed: "Belum ada riwayat backup.",
};

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;
type Confirm = { title: string; body: string; label: string; run: () => Promise<{ message: string }> } | null;

/**
 * Admin/operator backup desk: approve or reject applicants, assign covers in emergencies.
 */
export default function BackupDesk() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("pending");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const requests = useApiData(tab, () => operatorBackupApi.list(token, tab));
  const list = requests.data?.requests;

  async function act(action: () => Promise<{ message: string }>) {
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    requests.reload();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup label="Status backup" options={tabs} value={tab} onChange={setTab} />
        <Button type="button" variant="outline" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          Ajukan untuk host
        </Button>
      </div>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {requests.error && <ErrorState message={requests.error} onRetry={requests.reload} />}
      {!list && !requests.error && <CardsSkeleton count={2} />}

      {list?.length === 0 && (
        <div className="rounded-xl border border-dashed border-input bg-card/50">
          <EmptyState icon={Inbox} title="Tidak ada data" description={emptyText[tab]} />
        </div>
      )}

      <ul className={cn("space-y-3 transition-opacity", requests.loading && list && "opacity-60")}>
        {list?.map((backup) => (
          <RequestCard key={backup.id} backup={backup} act={act} onConfirm={setConfirm} />
        ))}
      </ul>

      {creating && (
        <OnBehalfForm
          onDone={(message) => {
            setCreating(false);
            notify({ text: message });
            setTab("open");
            requests.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {confirm && (
        <ConfirmDialog title={confirm.title} confirmLabel={confirm.label} onConfirm={() => act(confirm.run)} onClose={() => setConfirm(null)}>
          {confirm.body}
        </ConfirmDialog>
      )}
    </div>
  );
}

function RequestCard({ backup, act, onConfirm }: { backup: BackupRequest; act: Act; onConfirm: (confirm: Confirm) => void }) {
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
    <li className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs dark:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {backup.requester && <UserAvatar user={backup.requester.user} size="size-10 text-sm" />}
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {backup.requester?.user.name}
              <span className="font-normal text-muted-foreground"> · {backup.brand.name}</span>
            </p>
            <p className="flex items-center gap-1.5 text-sm text-body tabular-nums">
              <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {formatWindow(backup.start_at, backup.end_at)}
            </p>
            <p className="mt-1 text-sm text-body">
              {reasonLabels[backup.reason_type]}
              {backup.reason && <span className="text-muted-foreground"> · {backup.reason}</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <RequestTypeBadge names={nomineeNames} />
          <BackupStatusBadge status={backup.status} />
        </div>
      </div>

      {(backup.letter_status !== "not_needed" || waiting) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {backup.letter_status !== "not_needed" && (
            <span className="flex items-center gap-2">
              <LetterBadge status={backup.letter_status} />
              {backup.letter_status === "uploaded" && (
                <button type="button" onClick={openLetter} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  Lihat
                  <ExternalLink className="size-3" aria-hidden="true" />
                </button>
              )}
            </span>
          )}
          {waiting && (
            <span>
              <span className="font-medium text-foreground tabular-nums">{backup.applicants_count ?? 0}</span> mendaftar · pendaftar terbaik disetujui otomatis{" "}
              {formatDateTime(backup.auto_fill_at)}
            </span>
          )}
        </div>
      )}
      {letterError && <FormAlert tone="error">{letterError}</FormAlert>}

      {backup.status === "filled" && backup.filler && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <UserAvatar user={backup.filler.user} size="size-6 text-[10px]" />
          <span className="font-medium text-success">Digantikan {backup.filler.user.name}</span>
          {backup.auto_filled && <span className="text-xs text-muted-foreground">(disetujui otomatis)</span>}
          {backup.counts_toward_quota && <span className="text-xs text-muted-foreground">· brand lain, memakai kuota</span>}
        </div>
      )}

      {running && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {waiting && (
            <Button type="button" size="sm" variant={choosing ? "outline" : "default"} onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
              {choosing ? "Tutup" : backup.status === "pending" ? "Cek pendaftar" : "Tunjuk pengganti"}
              <ChevronDown className={cn("transition-transform", choosing && "rotate-180")} aria-hidden="true" />
            </Button>
          )}
          {backup.status === "filled" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onConfirm({
                  title: "Ganti pengganti?",
                  body: `${backup.filler?.user.name ?? "Pengganti"} dilepas tanpa penalti dan permintaan dibuka lagi.`,
                  label: "Lepas pengganti",
                  run: () => operatorBackupApi.unassign(token, backup.id),
                })
              }
            >
              Ganti pengganti
            </Button>
          )}
          {["pending", "open", "filled"].includes(backup.status) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                onConfirm({
                  title: "Batalkan permintaan backup?",
                  body: `Permintaan ${backup.requester?.user.name ?? "host"} untuk ${backup.brand.name}, ${formatWindow(backup.start_at, backup.end_at)}, dibatalkan seluruhnya.`,
                  label: "Batalkan permintaan",
                  run: () => operatorBackupApi.cancel(token, backup.id),
                })
              }
            >
              Batalkan permintaan
            </Button>
          )}
        </div>
      )}

      {choosing && waiting && <CoverPicker backup={backup} act={act} onConfirm={onConfirm} />}
    </li>
  );
}

/** Applicants (ranked) plus, on demand, every other host for emergencies. */
function CoverPicker({ backup, act, onConfirm }: { backup: BackupRequest; act: Act; onConfirm: (confirm: Confirm) => void }) {
  const { token } = useAuth();
  const [showEveryone, setShowEveryone] = useState(false);
  const applicants = useApiData(`applicants-${backup.id}`, () => operatorBackupApi.applicants(token, backup.id));
  const everyone = useApiData(`candidates-${backup.id}-${showEveryone}`, () =>
    showEveryone ? operatorBackupApi.candidates(token, backup.id) : Promise.resolve({ candidates: [] })
  );

  const pick = (candidate: BackupCandidate) => act(() => operatorBackupApi.assign(token, backup.id, candidate.host_id));
  const reject = (candidate: BackupCandidate) =>
    onConfirm({
      title: `Tolak ${candidate.name}?`,
      body: "Kalau tidak ada pendaftar lain, permintaan dibuka lagi.",
      label: "Tolak pendaftar",
      run: () => operatorBackupApi.rejectApplicant(token, backup.id, candidate.host_id),
    });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">Pendaftar, terbaik di atas (rating tertinggi, lalu brand yang sama, lalu yang mendaftar paling awal).</p>
      {!applicants.data && <ListSkeleton rows={2} />}
      {applicants.data?.applicants.length === 0 && <p className="text-sm text-muted-foreground">Belum ada yang mendaftar.</p>}
      <CandidateList candidates={applicants.data?.applicants ?? []} onPick={pick} onReject={reject} />

      {showEveryone ? (
        <>
          <p className="pt-2 text-xs text-muted-foreground">Semua host (untuk darurat; tidak harus sudah mendaftar atau diminta).</p>
          {everyone.loading && !everyone.data?.candidates.length && <ListSkeleton rows={3} />}
          <CandidateList candidates={everyone.data?.candidates ?? []} onPick={pick} />
        </>
      ) : (
        <Button type="button" variant="link" size="sm" onClick={() => setShowEveryone(true)} className="h-auto px-0">
          <UserRoundPlus aria-hidden="true" />
          Tunjuk host yang tidak mendaftar
        </Button>
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
    <ul className="space-y-1.5">
      {candidates.map((candidate, index) => (
        <li key={candidate.host_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          {onReject && <span className="w-4 text-center text-xs font-semibold text-faint tabular-nums">{index + 1}</span>}
          <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="size-8 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{candidate.name}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {candidate.rating != null && (
                <span className="inline-flex items-center gap-0.5 font-medium text-foreground tabular-nums">
                  <Star className="size-3 fill-warning text-warning" aria-hidden="true" />
                  {candidate.rating.toFixed(1)}
                </span>
              )}
              <span>{candidate.same_brand ? "Brand yang sama" : `Brand lain · kuota ${candidate.quota.quota_used}/${candidate.quota.quota_max}`}</span>
              {candidate.ineligible_reason && <span className="text-destructive">· {candidate.ineligible_reason}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {onReject && (
              <Button type="button" size="sm" variant="outline" onClick={() => onReject(candidate)}>
                Tolak
              </Button>
            )}
            <Button type="button" size="sm" variant="success" disabled={!candidate.eligible} onClick={() => onPick(candidate)}>
              Setujui
            </Button>
          </div>
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

  return (
    <Modal title="Ajukan backup untuk host" description="Langsung muncul di papan backup, juga untuk sesi yang akan segera mulai." onClose={onCancel}>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-date">Tanggal</Label>
          <input
            id="on-behalf-date"
            type="date"
            value={date}
            min={toDateInput()}
            onChange={(event) => event.target.value && setDate(event.target.value)}
            className={cn(inputClass, "tabular-nums")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-slot">Sesi</Label>
          <NativeSelect id="on-behalf-slot" name="slot_id" disabled={daySlots.length === 0}>
            {daySlots.length === 0 && <option>{slots.loading ? "Memuat sesi…" : "Tidak ada sesi di hari itu"}</option>}
            {daySlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.assignment.host?.user.name} · {slot.assignment.brand.name} · {formatTimeRange(slot.start_time, slot.end_time, slot.day_of_week)}
              </option>
            ))}
          </NativeSelect>
          <FieldError>{errors.slot_id ?? errors.backup_date}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-reason-type">Alasan</Label>
          <NativeSelect id="on-behalf-reason-type" value={reasonType} onChange={(event) => setReasonType(event.target.value as BackupReason)}>
            {(Object.keys(reasonLabels) as BackupReason[]).map((value) => (
              <option key={value} value={value}>
                {reasonLabels[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-reason">
            Keterangan <span className="font-normal text-muted-foreground">(opsional)</span>
          </Label>
          <input id="on-behalf-reason" name="reason" maxLength={1000} className={inputClass} />
        </div>
        <FormActions loading={loading} submitLabel="Buka permintaan" onCancel={onCancel} disabled={daySlots.length === 0} />
      </form>
    </Modal>
  );
}
