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
  internal: "Pelanggaran",
  brand_complaint: "Komplain brand",
  backup_cancel: "Membatalkan backup (otomatis)",
  late_attachment: "Surat sakit terlambat (otomatis)",
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
        <p className="text-sm text-muted">
          Periode poin {formatDate(hosts.data.period.start)} – {formatDate(hosts.data.period.end)}. Semua mulai dari 100; SP terbit
          otomatis di{" "}
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
              placeholder="Cari host…"
              className="w-full px-3 py-2 rounded-lg bg-surface border border-stroke text-heading placeholder-faint"
            />
          </form>
          <ul className={`space-y-1 ${hosts.loading ? "opacity-60" : ""}`}>
            {hosts.data?.hosts.map((host) => (
              <li key={host.host_id}>
                <button
                  type="button"
                  onClick={() => setSelected(host.host_id)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left ${
                    host.host_id === hostId ? "bg-primary/20 border border-primary/50" : "bg-surface border border-stroke hover:bg-surface-2"
                  }`}
                >
                  <UserAvatar user={host} size="w-7 h-7" />
                  <span className="flex-1 min-w-0 truncate text-sm text-heading">{host.name}</span>
                  <SpBadge level={host.sp_level} />
                  <span className={`text-sm font-medium ${host.points < 100 ? "text-warning" : "text-muted"}`}>{host.points}</span>
                </button>
              </li>
            ))}
            {hosts.data?.hosts.length === 0 && <li className="text-sm text-muted px-1">Tidak ada host aktif.</li>}
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
  if (!detail.data) return <p className="text-muted">Memuat…</p>;
  const data = detail.data;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <UserAvatar user={data.host.user} size="w-10 h-10" />
          <div>
            <p className="text-heading font-medium">{data.host.user.name}</p>
            <p className="text-xs text-muted">
              {formatDate(data.period.start)} – {formatDate(data.period.end)}
            </p>
          </div>
        </div>
        <PointsMeter points={data.points} opening={data.opening_points} thresholds={data.thresholds} />
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => setForm("violation")}>Catat pelanggaran</ActionButton>
          <ActionButton onClick={() => setForm("complaint")}>Komplain brand</ActionButton>
          {isAdmin && <ActionButton onClick={() => setForm("sp")}>Terbitkan SP manual</ActionButton>}
        </div>
        {form === "violation" && (
          <Modal title={`Catat pelanggaran · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <ViolationForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
        {form === "complaint" && (
          <Modal title={`Komplain brand · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <ComplaintForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
        {form === "sp" && (
          <Modal title={`Terbitkan SP manual · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <WarningForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
      </Card>

      <Card title="Periode ini">
        {data.logs.length === 0 && <p className="text-sm text-muted">Tidak ada potongan.</p>}
        <ul className="space-y-2">
          {data.logs.map((log) => (
            <li key={log.id} className={`rounded-lg px-3 py-2 ${log.voided_at ? "bg-surface-2" : "bg-surface-2"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-sm ${log.voided_at ? "text-faint line-through" : "text-heading"}`}>
                  {log.violation_type?.name ?? sourceLabels[log.source]}
                  {log.brand_complaint && <span className="text-muted"> · {log.brand_complaint.brand.name}</span>}
                </span>
                <span className={`text-sm font-medium ${log.voided_at ? "text-faint" : log.points_change < 0 ? "text-danger" : "text-success"}`}>
                  {log.points_change > 0 ? "+" : ""}
                  {log.points_change}
                </span>
              </div>
              <p className="text-xs text-muted">
                {formatShortDate(log.occurred_on)} · {sourceLabels[log.source]}
                {log.recorder ? ` · oleh ${log.recorder.name}` : ""}
                {log.voided_at ? " · dibatalkan" : ""}
              </p>
              {log.reason && <p className="text-xs text-body mt-1">{log.reason}</p>}
              {isAdmin && !log.voided_at && (
                <button
                  type="button"
                  onClick={() => confirm("Batalkan catatan ini? Poinnya dikembalikan.") && act(() => pointsApi.voidLog(token, log.id))}
                  className="mt-1 text-xs text-danger hover:text-danger"
                >
                  Batalkan catatan
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
    <Card title="Surat peringatan">
      {data.warning_letters.length === 0 && <p className="text-sm text-muted">Tidak ada.</p>}
      <ul className="space-y-2">
        {data.warning_letters.map((letter) => (
          <li key={letter.id} className="flex items-start gap-3 rounded-lg bg-surface-2 px-3 py-2">
            <SpBadge level={letter.voided_at ? 0 : letter.level} />
            {letter.voided_at && <span className="text-xs text-faint line-through">SP{letter.level}</span>}
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${letter.voided_at ? "text-faint line-through" : "text-heading"}`}>{letter.reason}</p>
              <p className="text-xs text-muted">
                {formatDate(letter.issued_at)} · {letter.issuer ? `oleh ${letter.issuer.name}` : "otomatis"}
                {letter.voided_at ? " · dibatalkan" : ""}
              </p>
            </div>
            {isAdmin && !letter.voided_at && (
              <button
                type="button"
                onClick={() => confirm(`Batalkan SP${letter.level}?`) && act(() => pointsApi.voidWarning(token, letter.id))}
                className="text-xs text-danger hover:text-danger"
              >
                Batalkan
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
    <button type="button" onClick={onClick} className="px-3 py-1.5 rounded-lg text-sm border border-stroke-strong text-body hover:bg-surface-2">
      {children}
    </button>
  );
}

const input = "w-full px-3 py-2 rounded-lg bg-surface-2 border border-stroke-strong text-heading";

type FormProps = { hostId: string; onDone: (message: string) => void; onCancel: () => void };

function FormButtons({ loading, label, onCancel }: { loading: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="sm:col-span-full flex gap-3">
      <div className="w-40">
        <SubmitButton loading={loading}>{label}</SubmitButton>
      </div>
      <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-body hover:bg-surface-2">
        Batal
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
        <span className="block text-xs text-muted">Pelanggaran</span>
        <select value={chosen?.id ?? ""} onChange={(event) => setTypeId(event.target.value)} className={input}>
          {types.data?.violation_types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name} (−{type.default_points})
            </option>
          ))}
        </select>
        {errors.violation_type_id && <span className="text-xs text-danger">{errors.violation_type_id}</span>}
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted">Poin yang dipotong</span>
        <input key={chosen?.id} name="points" type="number" min={1} max={100} placeholder={String(chosen?.default_points ?? "")} className={input} />
        {errors.points && <span className="text-xs text-danger">{errors.points}</span>}
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted">Tanggal</span>
        <input name="occurred_on" type="date" defaultValue={toDateInput()} max={toDateInput()} className={input} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted">Kejadiannya</span>
        <input name="reason" maxLength={255} className={input} />
      </label>
      <FormButtons loading={loading} label="Catat" onCancel={onCancel} />
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
        <span className="block text-xs text-muted">Brand</span>
        <select name="brand_id" className={input}>
          {brands.data?.brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted">Poin yang dipotong (kosong = bawaan)</span>
        <input name="points" type="number" min={1} max={100} className={input} />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="block text-xs text-muted">Keluhan dari brand</span>
        <textarea name="description" rows={2} maxLength={2000} className={input} />
        {errors.description && <span className="text-xs text-danger">{errors.description}</span>}
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted">Tanggal</span>
        <input name="occurred_on" type="date" defaultValue={toDateInput()} max={toDateInput()} className={input} />
      </label>
      <FormButtons loading={loading} label="Catat" onCancel={onCancel} />
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
        <span className="block text-xs text-muted">Level</span>
        <select name="level" className={input}>
          <option value="1">SP1</option>
          <option value="2">SP2</option>
          <option value="3">SP3</option>
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted">Alasan</span>
        <input name="reason" maxLength={255} className={input} />
        {errors.reason && <span className="text-xs text-danger">{errors.reason}</span>}
      </label>
      <FormButtons loading={loading} label="Terbitkan" onCancel={onCancel} />
    </form>
  );
}
