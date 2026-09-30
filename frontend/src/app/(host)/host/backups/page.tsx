"use client";

import { useState } from "react";
import { errorMessage, hostBackupApi, settingsApi, type BackupNeed, type BackupReason, type BackupRequest } from "@/lib/api";
import { formatDateTime, formatDuration, formatWindow } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import { BackupStatusBadge, LetterBadge, reasonLabels } from "@/components/BackupBadges";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";
import SubmitButton from "@/components/SubmitButton";

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
            ["needs", "Backup needs"],
            ["mine", "My requests"],
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
        <MineTab requests={mine.data?.requests} act={act} onRequested={() => mine.reload()} />
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
        <Card title="You're covering">
          <ul className="space-y-2">
            {upcomingCovers.map((cover) => (
              <li key={cover.id} className="rounded-lg bg-green-500/10 border border-green-400/30 px-3 py-2 space-y-1">
                <p className="text-white">{cover.brand.name}</p>
                <p className="text-sm text-green-200">{formatWindow(cover.start_at, cover.end_at)}</p>
                <p className="text-xs text-gray-400">for {cover.requester_name}</p>
                {new Date(cover.start_at) > new Date() && (
                  <button
                    type="button"
                    onClick={() =>
                      confirm("Drop this backup? It will reopen for others and you will get a point penalty.") &&
                      act(() => hostBackupApi.drop(token, cover.id))
                    }
                    className="text-xs text-red-300 hover:text-red-200"
                  >
                    I can&apos;t make it
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {quota && (
        <p className="text-xs text-gray-400">
          Helping other brands this month: {quota.quota_used}/{quota.quota_max}. Covering your own brand doesn&apos;t count.
        </p>
      )}

      {needs?.length === 0 && (
        <Card>
          <p className="text-sm text-gray-400">No one needs a backup right now.</p>
        </Card>
      )}

      {needs?.map((need) => {
        const applied = need.my_application?.status === "applied";

        return (
          <Card key={need.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-white font-medium">{need.brand.name}</p>
                <p className="text-sm text-purple-200">{formatWindow(need.start_at, need.end_at)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  for {need.requester_name} · {need.same_brand ? "your brand" : "other brand (uses quota)"}
                </p>
              </div>
              {applied ? (
                <button
                  type="button"
                  onClick={() => act(() => hostBackupApi.withdraw(token, need.id))}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-700 text-sm text-gray-300 hover:bg-slate-800"
                >
                  Withdraw
                </button>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(need.ineligible_reason)}
                  onClick={() => act(() => hostBackupApi.apply(token, need.id))}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-600 text-sm text-white hover:bg-purple-500 disabled:opacity-40"
                >
                  Apply
                </button>
              )}
            </div>
            {applied && <p className="text-xs text-green-300">You applied. An admin will choose who covers it.</p>}
            {!applied && need.ineligible_reason && <p className="text-xs text-gray-400">{need.ineligible_reason}</p>}
          </Card>
        );
      })}
    </div>
  );
}

function MineTab({ requests, act, onRequested }: { requests?: BackupRequest[]; act: Act; onRequested: () => void }) {
  const { token } = useAuth();
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-4">
      {formOpen ? (
        <RequestForm
          onDone={() => {
            setFormOpen(false);
            onRequested();
          }}
          onCancel={() => setFormOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="w-full px-4 py-3 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-500"
        >
          I need a backup
        </button>
      )}

      {requests?.length === 0 && <p className="text-sm text-gray-400 text-center">You haven&apos;t requested a backup yet.</p>}

      {requests?.map((backup) => (
        <Card key={backup.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-white font-medium">{backup.brand.name}</p>
              <p className="text-sm text-purple-200">{formatWindow(backup.start_at, backup.end_at)}</p>
              <p className="text-xs text-gray-400 mt-1">
                {reasonLabels[backup.reason_type]}
                {backup.reason && ` · ${backup.reason}`}
              </p>
            </div>
            <BackupStatusBadge status={backup.status} />
          </div>

          {backup.status === "filled" && backup.filler && (
            <p className="text-sm text-green-300">Covered by {backup.filler.user.name}</p>
          )}
          {backup.status === "pending" && backup.auto_open_at && (
            <p className="text-xs text-gray-400">Opens to other hosts automatically at {formatDateTime(backup.auto_open_at)} if no admin replies.</p>
          )}

          {backup.letter_status !== "not_needed" && (
            <div className="flex flex-wrap items-center gap-3">
              <LetterBadge status={backup.letter_status} />
              {backup.letter_status !== "uploaded" && backup.letter_due_at && (
                <span className="text-xs text-gray-400">due {formatDateTime(backup.letter_due_at)}</span>
              )}
              <label className="text-xs text-purple-300 hover:text-white cursor-pointer">
                {backup.letter_status === "uploaded" ? "Replace letter" : "Upload letter"}
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
              onClick={() => confirm("Cancel this backup request?") && act(() => hostBackupApi.cancel(token, backup.id))}
              className="text-xs text-red-300 hover:text-red-200"
            >
              Cancel request
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}

function RequestForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { token } = useAuth();
  const letterHours = useApiData("public-settings", () => settingsApi.public(token)).data?.settings["backup.sick_letter_grace_hours"];
  const slots = useApiData("backup-slots", () => hostBackupApi.slots(token));
  const [reasonType, setReasonType] = useState<BackupReason>("sick");

  const { loading, errors, error, handleSubmit } = useApiForm((data) => {
    const [slotId, date] = formValue(data, "occurrence").split("|");
    return hostBackupApi.request(token, {
      slot_id: slotId,
      backup_date: date,
      reason_type: reasonType,
      reason: formValue(data, "reason") || null,
    });
  }, onDone);

  return (
    <Card title="Request a backup" description="Pick the session you can't do. An admin approves it, then other hosts can apply.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <div className="space-y-1">
          <label htmlFor="occurrence" className="block text-sm font-medium text-gray-200">
            Session
          </label>
          {slots.data?.slots.length === 0 ? (
            <p className="text-sm text-gray-400">You have no sessions in the next 14 days.</p>
          ) : (
            <select id="occurrence" name="occurrence" className="w-full px-4 py-2.5 rounded-xl bg-slate-900/60 border border-white/15 text-white">
              {slots.data?.slots.map((slot) => (
                <option key={`${slot.slot_id}|${slot.date}`} value={`${slot.slot_id}|${slot.date}`}>
                  {formatWindow(slot.start_at, slot.end_at)} · {slot.brand.name}
                </option>
              ))}
            </select>
          )}
          {(errors.backup_date || errors.slot_id) && <p className="text-sm text-red-300">{errors.backup_date ?? errors.slot_id}</p>}
        </div>

        <fieldset className="space-y-1">
          <legend className="block text-sm font-medium text-gray-200">Reason</legend>
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
          {reasonType === "sick" && (
            <p className="text-xs text-gray-400">
              You&apos;ll need to upload a doctor&apos;s letter{letterHours ? ` within ${formatDuration(letterHours)}` : ""} after the session starts.
            </p>
          )}
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="reason" className="block text-sm font-medium text-gray-200">
            Details (optional)
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={2}
            maxLength={1000}
            className="w-full px-4 py-2.5 rounded-xl bg-slate-900/60 border border-white/15 text-white outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex gap-3">
          <SubmitButton loading={loading}>Send request</SubmitButton>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-gray-300 hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
