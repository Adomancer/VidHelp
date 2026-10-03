"use client";

import { useState } from "react";
import { errorMessage, operatorApi, pointsApi, type PointLog, type PointsHostDetail, type ViolationType } from "@/lib/api";
import { formatDate, formatShortDate, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
import Modal from "./Modal";
import PointsMeter, { SpBadge } from "./PointsMeter";
import SubmitButton from "./SubmitButton";
import UserAvatar from "./UserAvatar";

type Notice = { tone: "success" | "error"; text: string } | null;

export const sourceLabels: Record<PointLog["source"], string> = {
  internal: "Violation",
  brand_complaint: "Brand complaint",
  backup_cancel: "Dropped backup (automatic)",
  late_attachment: "Late sick letter (automatic)",
};

/**
 * Points desk: every host's points this period, and one host's history with
 * forms to record a violation or a brand complaint. Admins can also correct entries and SPs.
 */
export default function PointsDesk({ isAdmin = false }: { isAdmin?: boolean }) {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const hosts = useApiData(`points-${search}`, () => pointsApi.hosts(token, search));

  const hostId = selected ?? hosts.data?.hosts[0]?.host_id ?? null;

  return (
    <div className="space-y-4">
      {hosts.data && (
        <p className="text-sm text-gray-400">
          Points period {formatDate(hosts.data.period.start)} – {formatDate(hosts.data.period.end)}. Everyone starts at 100; an SP is issued
          automatically at{" "}
          {Object.entries(hosts.data.thresholds)
            .map(([level, points]) => `SP${level} ≤ ${points}`)
            .join(", ")}
          .
        </p>
      )}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {hosts.error && <FormAlert tone="error">{hosts.error}</FormAlert>}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(String(new FormData(event.currentTarget).get("search") ?? ""));
            }}
          >
            <input
              name="search"
              type="search"
              placeholder="Search host…"
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-gray-500"
            />
          </form>
          <ul className={`space-y-1 ${hosts.loading ? "opacity-60" : ""}`}>
            {hosts.data?.hosts.map((host) => (
              <li key={host.host_id}>
                <button
                  type="button"
                  onClick={() => setSelected(host.host_id)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left ${
                    host.host_id === hostId ? "bg-purple-600/20 border border-purple-500/50" : "bg-slate-900 border border-slate-800 hover:bg-slate-800"
                  }`}
                >
                  <UserAvatar user={host} size="w-7 h-7" />
                  <span className="flex-1 min-w-0 truncate text-sm text-white">{host.name}</span>
                  <SpBadge level={host.sp_level} />
                  <span className={`text-sm font-medium ${host.points < 100 ? "text-yellow-200" : "text-gray-400"}`}>{host.points}</span>
                </button>
              </li>
            ))}
            {hosts.data?.hosts.length === 0 && <li className="text-sm text-gray-400 px-1">No active hosts.</li>}
          </ul>
        </div>

        {hostId && (
          <HostPoints
            key={hostId}
            hostId={hostId}
            isAdmin={isAdmin}
            onChanged={(message, tone = "success") => {
              setNotice({ tone, text: message });
              hosts.reload();
            }}
          />
        )}
      </div>
    </div>
  );
}

function HostPoints({ hostId, isAdmin, onChanged }: { hostId: string; isAdmin: boolean; onChanged: (message: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`points-host-${hostId}`, () => pointsApi.host(token, hostId));
  const [form, setForm] = useState<"violation" | "complaint" | "sp" | null>(null);

  async function act(action: () => Promise<{ message: string }>) {
    try {
      onChanged((await action()).message);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
    detail.reload();
  }

  const done = (message: string) => {
    setForm(null);
    onChanged(message);
    detail.reload();
  };

  if (detail.error) return <FormAlert tone="error">{detail.error}</FormAlert>;
  if (!detail.data) return <p className="text-gray-400">Loading…</p>;
  const data = detail.data;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <UserAvatar user={data.host.user} size="w-10 h-10" />
          <div>
            <p className="text-white font-medium">{data.host.user.name}</p>
            <p className="text-xs text-gray-400">
              {formatDate(data.period.start)} – {formatDate(data.period.end)}
            </p>
          </div>
        </div>
        <PointsMeter points={data.points} opening={data.opening_points} thresholds={data.thresholds} />
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => setForm("violation")}>Record violation</ActionButton>
          <ActionButton onClick={() => setForm("complaint")}>Brand complaint</ActionButton>
          {isAdmin && <ActionButton onClick={() => setForm("sp")}>Issue SP by hand</ActionButton>}
        </div>
        {form === "violation" && (
          <Modal title={`Record violation · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <ViolationForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
        {form === "complaint" && (
          <Modal title={`Brand complaint · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <ComplaintForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
        {form === "sp" && (
          <Modal title={`Issue SP by hand · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <WarningForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
      </Card>

      <Card title="This period">
        {data.logs.length === 0 && <p className="text-sm text-gray-400">No deductions.</p>}
        <ul className="space-y-2">
          {data.logs.map((log) => (
            <li key={log.id} className={`rounded-lg px-3 py-2 ${log.voided_at ? "bg-slate-800/30" : "bg-slate-800"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-sm ${log.voided_at ? "text-gray-500 line-through" : "text-white"}`}>
                  {log.violation_type?.name ?? sourceLabels[log.source]}
                  {log.brand_complaint && <span className="text-gray-400"> · {log.brand_complaint.brand.name}</span>}
                </span>
                <span className={`text-sm font-medium ${log.voided_at ? "text-gray-500" : log.points_change < 0 ? "text-red-300" : "text-green-300"}`}>
                  {log.points_change > 0 ? "+" : ""}
                  {log.points_change}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {formatShortDate(log.occurred_on)} · {sourceLabels[log.source]}
                {log.recorder ? ` · by ${log.recorder.name}` : ""}
                {log.voided_at ? " · cancelled" : ""}
              </p>
              {log.reason && <p className="text-xs text-gray-300 mt-1">{log.reason}</p>}
              {isAdmin && !log.voided_at && (
                <button
                  type="button"
                  onClick={() => confirm("Cancel this entry? The points come back.") && act(() => pointsApi.voidLog(token, log.id))}
                  className="mt-1 text-xs text-red-300 hover:text-red-200"
                >
                  Cancel entry
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <WarningsCard data={data} isAdmin={isAdmin} act={act} />
    </div>
  );
}

function WarningsCard({ data, isAdmin, act }: { data: PointsHostDetail; isAdmin: boolean; act: (action: () => Promise<{ message: string }>) => Promise<void> }) {
  const { token } = useAuth();

  return (
    <Card title="Warning letters">
      {data.warning_letters.length === 0 && <p className="text-sm text-gray-400">None.</p>}
      <ul className="space-y-2">
        {data.warning_letters.map((letter) => (
          <li key={letter.id} className="flex items-start gap-3 rounded-lg bg-slate-800 px-3 py-2">
            <SpBadge level={letter.voided_at ? 0 : letter.level} />
            {letter.voided_at && <span className="text-xs text-gray-500 line-through">SP{letter.level}</span>}
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${letter.voided_at ? "text-gray-500 line-through" : "text-white"}`}>{letter.reason}</p>
              <p className="text-xs text-gray-400">
                {formatDate(letter.issued_at)} · {letter.issuer ? `by ${letter.issuer.name}` : "automatic"}
                {letter.voided_at ? " · cancelled" : ""}
              </p>
            </div>
            {isAdmin && !letter.voided_at && (
              <button
                type="button"
                onClick={() => confirm(`Cancel SP${letter.level}?`) && act(() => pointsApi.voidWarning(token, letter.id))}
                className="text-xs text-red-300 hover:text-red-200"
              >
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="px-3 py-1.5 rounded-lg text-sm border border-slate-700 text-gray-300 hover:bg-slate-800">
      {children}
    </button>
  );
}

const input = "w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white";

type FormProps = { hostId: string; onDone: (message: string) => void; onCancel: () => void };

function FormButtons({ loading, label, onCancel }: { loading: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="sm:col-span-full flex gap-3">
      <div className="w-40">
        <SubmitButton loading={loading}>{label}</SubmitButton>
      </div>
      <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-gray-300 hover:bg-slate-800">
        Cancel
      </button>
    </div>
  );
}

function ViolationForm({ hostId, onDone, onCancel }: FormProps) {
  const { token } = useAuth();
  const types = useApiData("violation-types", () => pointsApi.violationTypes(token));
  const [typeId, setTypeId] = useState("");
  const chosen: ViolationType | undefined = types.data?.violation_types.find((type) => type.id === typeId) ?? types.data?.violation_types[0];

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      pointsApi.recordViolation(token, {
        host_id: hostId,
        violation_type_id: chosen?.id ?? "",
        points: formValue(data, "points") ? Number(formValue(data, "points")) : null,
        reason: formValue(data, "reason") || null,
        occurred_on: formValue(data, "occurred_on"),
      }),
    ({ message }) => onDone(message)
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Violation</span>
        <select value={chosen?.id ?? ""} onChange={(event) => setTypeId(event.target.value)} className={input}>
          {types.data?.violation_types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name} (−{type.default_points})
            </option>
          ))}
        </select>
        {errors.violation_type_id && <span className="text-xs text-red-300">{errors.violation_type_id}</span>}
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Points to deduct</span>
        <input key={chosen?.id} name="points" type="number" min={1} max={100} placeholder={String(chosen?.default_points ?? "")} className={input} />
        {errors.points && <span className="text-xs text-red-300">{errors.points}</span>}
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Date</span>
        <input name="occurred_on" type="date" defaultValue={toDateInput()} max={toDateInput()} className={input} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">What happened</span>
        <input name="reason" maxLength={255} className={input} />
      </label>
      <FormButtons loading={loading} label="Record" onCancel={onCancel} />
    </form>
  );
}

function ComplaintForm({ hostId, onDone, onCancel }: FormProps) {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      pointsApi.recordComplaint(token, {
        host_id: hostId,
        brand_id: formValue(data, "brand_id"),
        description: formValue(data, "description"),
        points: formValue(data, "points") ? Number(formValue(data, "points")) : null,
        occurred_on: formValue(data, "occurred_on"),
      }),
    ({ message }) => onDone(message)
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Brand</span>
        <select name="brand_id" className={input}>
          {brands.data?.brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Points to deduct (empty = default)</span>
        <input name="points" type="number" min={1} max={100} className={input} />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="block text-xs text-gray-400">What the brand said</span>
        <textarea name="description" rows={2} maxLength={2000} className={input} />
        {errors.description && <span className="text-xs text-red-300">{errors.description}</span>}
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Date</span>
        <input name="occurred_on" type="date" defaultValue={toDateInput()} max={toDateInput()} className={input} />
      </label>
      <FormButtons loading={loading} label="Record" onCancel={onCancel} />
    </form>
  );
}

function WarningForm({ hostId, onDone, onCancel }: FormProps) {
  const { token } = useAuth();
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      pointsApi.issueWarning(token, {
        host_id: hostId,
        level: Number(formValue(data, "level")),
        reason: formValue(data, "reason"),
      }),
    ({ message }) => onDone(message)
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[8rem_1fr]" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Level</span>
        <select name="level" className={input}>
          <option value="1">SP1</option>
          <option value="2">SP2</option>
          <option value="3">SP3</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-gray-400">Reason</span>
        <input name="reason" maxLength={255} className={input} />
        {errors.reason && <span className="text-xs text-red-300">{errors.reason}</span>}
      </label>
      <FormButtons loading={loading} label="Issue" onCancel={onCancel} />
    </form>
  );
}
