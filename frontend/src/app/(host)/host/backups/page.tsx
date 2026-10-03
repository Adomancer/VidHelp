"use client";

import { useState } from "react";
import {
  errorMessage,
  hostBackupApi,
  settingsApi,
  type BackupNeed,
  type BackupReason,
  type BackupRequest,
  type BackupRequestType,
} from "@/lib/api";
import { formatDateTime, formatDuration, formatWindow } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import { BackupStatusBadge, LetterBadge, reasonLabels, RequestTypeBadge } from "@/components/BackupBadges";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";
import Modal from "@/components/Modal";
import SubmitButton from "@/components/SubmitButton";
import UserAvatar from "@/components/UserAvatar";

type Tab = "needs" | "mine";

export default function HostBackupsPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>("needs");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const mine = useApiData("backups-mine", () => hostBackupApi.mine(token));
  const needs = useApiData("backups-needs", () => hostBackupApi.needs(token));

  /** Run a button action, show its message, refresh both lists. */
  async function act(action: () => Promise<{ message: string }>) {
    setNotice(null);
    try {
      const { message } = await action();
      setNotice({ tone: "success", text: message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    }
    mine.reload();
    needs.reload();
  }

  return (
    <div className="max-w-lg space-y-5">
      <h1 className="text-xl font-bold text-white">Backup</h1>

      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-900 border border-slate-800">
        {(
          [
            ["needs", "Butuh backup"],
            ["mine", "Permintaan saya"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`py-2 rounded-lg text-sm ${tab === value ? "bg-purple-600 text-white" : "text-gray-300 hover:bg-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {(mine.error || needs.error) && <FormAlert tone="error">{mine.error ?? needs.error}</FormAlert>}

      {tab === "needs" ? (
        <NeedsTab covers={mine.data?.covers ?? []} needs={needs.data?.needs} quota={mine.data?.quota} act={act} />
      ) : (
        <MineTab
          requests={mine.data?.requests}
          act={act}
          onRequested={(message) => {
            setNotice({ tone: "success", text: message });
            mine.reload();
          }}
        />
      )}
    </div>
  );
}

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

function NeedsTab({
  covers,
  needs,
  quota,
  act,
}: {
  covers: BackupNeed[];
  needs?: BackupNeed[];
  quota?: { quota_used: number; quota_max: number };
  act: Act;
}) {
  const { token } = useAuth();
  const upcomingCovers = covers.filter((cover) => new Date(cover.end_at) > new Date());

  return (
    <div className="space-y-4">
      {upcomingCovers.length > 0 && (
        <Card title="Kamu menggantikan">
          <ul className="space-y-2">
            {upcomingCovers.map((cover) => (
              <li key={cover.id} className="rounded-lg bg-green-500/10 border border-green-400/30 px-3 py-2 space-y-1">
                <p className="text-white">{cover.brand.name}</p>
                <p className="text-sm text-green-200">{formatWindow(cover.start_at, cover.end_at)}</p>
                <p className="text-xs text-gray-400">untuk {cover.requester_name}</p>
                {new Date(cover.start_at) > new Date() && (
                  <button
                    type="button"
                    onClick={() =>
                      confirm("Batal jadi backup? Permintaan akan dibuka lagi untuk host lain dan kamu kena potongan poin.") &&
                      act(() => hostBackupApi.drop(token, cover.id))
                    }
                    className="text-xs text-red-300 hover:text-red-200"
                  >
                    Saya tidak bisa
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {quota && (
        <p className="text-xs text-gray-400">
          Membantu brand lain bulan ini: {quota.quota_used}/{quota.quota_max}. Menggantikan di brand sendiri tidak dihitung.
        </p>
      )}

      {needs?.length === 0 && (
        <Card>
          <p className="text-sm text-gray-400">Saat ini tidak ada yang butuh backup.</p>
        </Card>
      )}

      {needs?.map((need) => {
        const applied = need.my_application?.status === "applied";

        return (
          <Card key={need.id}>
            {need.asked_me && <p className="text-xs font-medium text-purple-200">{need.requester_name} meminta kamu menggantikan sesi ini</p>}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white font-medium">{need.brand.name}</p>
                <p className="text-sm text-purple-200">{formatWindow(need.start_at, need.end_at)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  untuk {need.requester_name} · {need.same_brand ? "brand kamu" : "brand lain (memakai kuota)"}
                </p>
              </div>
              {applied ? (
                <button
                  type="button"
                  onClick={() => act(() => hostBackupApi.withdraw(token, need.id))}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-700 text-sm text-gray-300 hover:bg-slate-800"
                >
                  Tarik diri
                </button>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(need.ineligible_reason)}
                  onClick={() => act(() => hostBackupApi.apply(token, need.id))}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-600 text-sm text-white hover:bg-purple-500 disabled:opacity-40"
                >
                  Daftar
                </button>
              )}
            </div>
            {!need.asked_me && <RequestTypeBadge names={need.nominee_names} />}
            {applied && <p className="text-xs text-green-300">Kamu sudah mendaftar. Menunggu persetujuan admin.</p>}
            {!applied && need.ineligible_reason && <p className="text-xs text-gray-400">{need.ineligible_reason}</p>}
          </Card>
        );
      })}
    </div>
  );
}

function MineTab({ requests, act, onRequested }: { requests?: BackupRequest[]; act: Act; onRequested: (message: string) => void }) {
  const { token } = useAuth();
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setFormOpen(true)}
        className="w-full px-4 py-3 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-500"
      >
        Saya butuh backup
      </button>
      {formOpen && (
        <RequestForm
          onDone={(message) => {
            setFormOpen(false);
            onRequested(message);
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {requests?.length === 0 && <p className="text-sm text-gray-400 text-center">Kamu belum pernah mengajukan backup.</p>}

      {requests?.map((backup) => (
        <Card key={backup.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-white font-medium">{backup.brand.name}</p>
              <p className="text-sm text-purple-200">{formatWindow(backup.start_at, backup.end_at)}</p>
              <p className="text-xs text-gray-400 mt-1">
                {reasonLabels[backup.reason_type]}
                {backup.reason && ` · ${backup.reason}`}
              </p>
            </div>
            <BackupStatusBadge status={backup.status} />
          </div>

          <RequestTypeBadge names={backup.nominees?.map((nominee) => nominee.host.user.name) ?? []} />

          {backup.status === "filled" && backup.filler && (
            <p className="text-sm text-green-300">Digantikan {backup.filler.user.name}</p>
          )}
          {backup.status === "open" && <p className="text-xs text-gray-400">Menunggu host mendaftar.</p>}
          {backup.status === "pending" && <p className="text-xs text-gray-400">Sudah ada yang mendaftar. Admin akan memilih penggantinya.</p>}

          {backup.letter_status !== "not_needed" && (
            <div className="flex flex-wrap items-center gap-3">
              <LetterBadge status={backup.letter_status} />
              {backup.letter_status !== "uploaded" && backup.letter_due_at && (
                <span className="text-xs text-gray-400">batas {formatDateTime(backup.letter_due_at)}</span>
              )}
              <label className="text-xs text-purple-300 hover:text-white cursor-pointer">
                {backup.letter_status === "uploaded" ? "Ganti surat" : "Unggah surat"}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) act(() => hostBackupApi.uploadLetter(token, backup.id, file));
                  }}
                />
              </label>
            </div>
          )}

          {(backup.status === "pending" || backup.status === "open") && (
            <button
              type="button"
              onClick={() => confirm("Batalkan permintaan backup ini?") && act(() => hostBackupApi.cancel(token, backup.id))}
              className="text-xs text-red-300 hover:text-red-200"
            >
              Batalkan permintaan
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}

const requestTypes: { value: BackupRequestType; label: string; hint: string }[] = [
  { value: "open", label: "Siapa saja", hint: "Semua host bisa mendaftar." },
  { value: "direct", label: "Pilih host", hint: "Hanya host yang kamu pilih yang bisa mendaftar." },
];

function RequestForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const settings = useApiData("public-settings", () => settingsApi.public(token)).data?.settings;
  const slots = useApiData("backup-slots", () => hostBackupApi.slots(token));
  const [reasonType, setReasonType] = useState<BackupReason>("sick");
  const [requestType, setRequestType] = useState<BackupRequestType>("open");
  const [pickedOccurrence, setPickedOccurrence] = useState("");
  const [hostIds, setHostIds] = useState<string[]>([]);

  const firstSlot = slots.data?.slots[0];
  const occurrence = pickedOccurrence || (firstSlot ? `${firstSlot.slot_id}|${firstSlot.date}` : "");
  const [slotId, date] = occurrence.split("|");

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => {
      const letter = data.get("letter");
      return hostBackupApi.request(token, {
        slot_id: slotId,
        backup_date: date,
        reason_type: reasonType,
        reason: formValue(data, "reason") || null,
        request_type: requestType,
        host_ids: hostIds,
        letter: letter instanceof File && letter.size > 0 ? letter : null,
      });
    },
    ({ message }) => onDone(message)
  );

  // Nothing to request for (yet): no form, so it can't be sent without a session
  if (!occurrence) {
    return (
      <Modal title="Ajukan backup" onClose={onCancel}>
        {slots.error && <FormAlert tone="error">{slots.error}</FormAlert>}
        <p className="text-sm text-gray-400">{slots.data ? "Tidak ada sesi yang masih bisa kamu ajukan backup." : "Memuat sesi kamu…"}</p>
        {slots.data && settings && (
          <p className="text-xs text-gray-400">
            Sesi yang kurang dari {formatDuration(settings["backup.request_min_hours_before"])} lagi tidak ditampilkan. Kalau mendadak tidak bisa,
            hubungi admin.
          </p>
        )}
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl text-gray-300 hover:bg-slate-800">
          Tutup
        </button>
      </Modal>
    );
  }

  return (
    <Modal title="Ajukan backup" description="Pilih sesi yang tidak bisa kamu jalani. Langsung masuk ke papan backup; admin yang menyetujui penggantinya." onClose={onCancel}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <div className="space-y-1">
          <label htmlFor="occurrence" className="block text-sm font-medium text-gray-200">
            Sesi
          </label>
          <select
            id="occurrence"
            value={occurrence}
            onChange={(event) => {
              setPickedOccurrence(event.target.value);
              setHostIds([]); // who is free depends on the session
            }}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-900/60 border border-white/15 text-white"
          >
            {slots.data?.slots.map((slot) => (
              <option key={`${slot.slot_id}|${slot.date}`} value={`${slot.slot_id}|${slot.date}`}>
                {formatWindow(slot.start_at, slot.end_at)} · {slot.brand.name}
              </option>
            ))}
          </select>
          {settings && (
            <p className="text-xs text-gray-400">
              Ajukan paling lambat {formatDuration(settings["backup.request_min_hours_before"])} sebelum sesi. Kalau lebih mendadak, hubungi
              admin.
            </p>
          )}
          {(errors.slot_id || errors.backup_date) && <p className="text-sm text-red-300">{errors.slot_id ?? errors.backup_date}</p>}
        </div>

        <fieldset className="space-y-1">
          <legend className="block text-sm font-medium text-gray-200">Alasan</legend>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(reasonLabels) as BackupReason[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setReasonType(value)}
                className={`py-2 rounded-lg text-sm ${reasonType === value ? "bg-purple-600 text-white" : "bg-slate-800 text-gray-300"}`}
              >
                {reasonLabels[value]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="reason" className="block text-sm font-medium text-gray-200">
            Keterangan (opsional)
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={2}
            maxLength={1000}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-900/60 border border-white/15 text-white outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="letter" className="block text-sm font-medium text-gray-200">
            {reasonType === "sick" ? "Surat dokter" : "Lampiran"} (boleh menyusul)
          </label>
          <input
            id="letter"
            name="letter"
            type="file"
            accept="image/*,application/pdf"
            className="block w-full text-sm text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-800 file:text-gray-200"
          />
          {reasonType === "sick" && settings && (
            <p className="text-xs text-gray-400">
              Kalau belum ada, unggah paling lambat {formatDuration(settings["backup.sick_letter_grace_hours"])} setelah sesi
              dimulai, atau poinmu dipotong.
            </p>
          )}
          {errors.letter && <p className="text-sm text-red-300">{errors.letter}</p>}
        </div>

        <fieldset className="space-y-2">
          <legend className="block text-sm font-medium text-gray-200">Siapa yang bisa menggantikan</legend>
          <div className="grid grid-cols-2 gap-2">
            {requestTypes.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRequestType(option.value)}
                className={`py-2 rounded-lg text-sm ${requestType === option.value ? "bg-purple-600 text-white" : "bg-slate-800 text-gray-300"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">{requestTypes.find((option) => option.value === requestType)?.hint}</p>
          {requestType === "direct" && occurrence && settings && (
            <NomineePicker
              slotId={slotId}
              date={date}
              min={settings["backup.direct_min_hosts"]}
              max={settings["backup.direct_max_hosts"]}
              selected={hostIds}
              onChange={setHostIds}
            />
          )}
          {errors.host_ids && <p className="text-sm text-red-300">{errors.host_ids}</p>}
        </fieldset>

        <div className="flex gap-3">
          <SubmitButton loading={loading}>Kirim permintaan</SubmitButton>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-gray-300 hover:bg-slate-800">
            Batal
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Tick the hosts to ask; busy or unavailable hosts can't be picked. */
function NomineePicker({
  slotId,
  date,
  min,
  max,
  selected,
  onChange,
}: {
  slotId: string;
  date: string;
  min: number;
  max: number;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { token } = useAuth();
  const candidates = useApiData(`nominees-${slotId}-${date}`, () => hostBackupApi.candidates(token, slotId, date));
  const full = selected.length >= max;

  function toggle(hostId: string) {
    onChange(selected.includes(hostId) ? selected.filter((id) => id !== hostId) : [...selected, hostId]);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-300">
        Dipilih {selected.length} · pilih {min} sampai {max} host
      </p>
      {candidates.error && <FormAlert tone="error">{candidates.error}</FormAlert>}
      {candidates.loading && !candidates.data && <p className="text-xs text-gray-400">Memuat host…</p>}
      <ul className="max-h-64 overflow-y-auto space-y-1.5">
        {candidates.data?.candidates.map((candidate) => {
          const checked = selected.includes(candidate.host_id);
          const disabled = !candidate.eligible || (full && !checked);

          return (
            <li key={candidate.host_id}>
              <label
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${checked ? "bg-purple-600/20 border border-purple-400/40" : "bg-slate-800/60 border border-transparent"} ${disabled ? "opacity-50" : "cursor-pointer"}`}
              >
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(candidate.host_id)} className="accent-purple-500" />
                <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="w-7 h-7" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-white truncate">{candidate.name}</span>
                  <span className="block text-xs text-gray-400 truncate">
                    {candidate.ineligible_reason ?? (candidate.same_brand ? "Brand kamu" : "Brand lain")}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
