"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { errorMessage, payrollApi, type CashAdvance, type PeriodListItem, type PeriodStatus } from "@/lib/api";
import { formatDate, formatDuration, formatRupiah } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import DurationInput from "./DurationInput";
import FormAlert from "./FormAlert";
import Modal from "./Modal";
import SubmitButton from "./SubmitButton";
import ToggleGroup from "./ToggleGroup";

type Notice = { tone: "success" | "error"; text: string } | null;

const statusStyles: Record<PeriodStatus, [string, string]> = {
  in_progress: ["Berjalan", "bg-blue-500/15 text-info"],
  waiting_payment: ["Siap ditagihkan", "bg-yellow-500/15 text-warning"],
  requested: ["Menunggu brand", "bg-primary/15 text-accent"],
  paid: ["Lunas", "bg-green-500/15 text-success"],
};

export function PeriodBadge({ status }: { status: PeriodStatus }) {
  const [label, style] = statusStyles[status];
  return <span className={`px-2 py-0.5 rounded-md text-xs whitespace-nowrap ${style}`}>{label}</span>;
}

/**
 * Admin payroll: payment periods per brand (lock, pay, slips) and kasbon.
 */
export default function PayrollDesk() {
  const [tab, setTab] = useState<"periods" | "kasbon">("periods");

  return (
    <div className="space-y-4">
      <ToggleGroup
        options={[
          ["periods", "Periode pembayaran"],
          ["kasbon", "Kasbon"],
        ] as const}
        value={tab}
        onChange={setTab}
      />
      {tab === "periods" ? <Periods /> : <Kasbon />}
    </div>
  );
}

function Periods() {
  const { token } = useAuth();
  const brands = useApiData("payroll-brands", () => payrollApi.brands(token));
  const [brandId, setBrandId] = useState("");
  const periods = useApiData(`periods-${brandId}`, () => payrollApi.periods(token, brandId));
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const withoutStart = brands.data?.brands.filter((brand) => brand.status === "active" && !brand.payroll_start_date) ?? [];

  return (
    <div className="space-y-4">
      {withoutStart.length > 0 && (
        <FormAlert tone="warning">
          Belum ada tanggal mulai penggajian untuk {withoutStart.map((brand) => brand.name).join(", ")}. Admin mengaturnya di halaman Brand supaya
          jam mereka masuk ke periode.
        </FormAlert>
      )}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {periods.error && <FormAlert tone="error">{periods.error}</FormAlert>}

      <select
        value={brandId}
        onChange={(event) => {
          setBrandId(event.target.value);
          setSelected(null);
        }}
        aria-label="Brand"
        className="px-3 py-2 rounded-lg bg-surface border border-stroke text-heading"
      >
        <option value="">Semua brand</option>
        {brands.data?.brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>

      <div className={`bg-surface border border-stroke rounded-[10px] shadow-card overflow-x-auto ${periods.loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2 border-b border-stroke">
            <tr>
              <th className="px-4 py-3 font-medium">Brand · periode</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Jam kerja</th>
              <th className="px-4 py-3 font-medium">Ditagihkan</th>
              <th className="px-4 py-3 font-medium text-right">Gaji host</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stroke">
            {periods.data?.periods.map((period) => (
              <PeriodRow key={period.id} period={period} selected={period.id === selected} onClick={() => setSelected(period.id === selected ? null : period.id)} />
            ))}
          </tbody>
        </table>
        {periods.data?.periods.length === 0 && <p className="px-4 py-8 text-center text-muted">Belum ada periode pembayaran.</p>}
      </div>

      {selected && (
        <PeriodDetail
          key={selected}
          periodId={selected}
          onChanged={(text, tone = "success") => {
            setNotice({ tone, text });
            periods.reload();
          }}
        />
      )}
    </div>
  );
}

function PeriodRow({ period, selected, onClick }: { period: PeriodListItem; selected: boolean; onClick: () => void }) {
  return (
    <tr onClick={onClick} className={`cursor-pointer text-body ${selected ? "bg-primary/10" : "hover:bg-surface-2"}`}>
      <td className="px-4 py-3">
        <p className="text-heading">{period.brand?.name}</p>
        <p className="text-xs text-muted">
          {formatDate(period.period_start)} – {formatDate(period.period_end)} · {period.hosts} host
        </p>
      </td>
      <td className="px-4 py-3">
        <PeriodBadge status={period.status} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{formatDuration(period.worked_hours)}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        {formatDuration(period.achieved_hours)} <span className="text-xs text-faint">/ {period.target_hours} jam</span>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">{formatRupiah(period.total_amount)}</td>
    </tr>
  );
}

function PeriodDetail({ periodId, onChanged }: { periodId: string; onChanged: (text: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`period-${periodId}`, () => payrollApi.period(token, periodId));
  // The desk is shared by the admin and finance panels; slips open in the same panel
  const slipsPath = usePathname().startsWith("/finance") ? "/finance/payroll/slips" : "/admin/payroll/slips";

  async function act(action: () => Promise<{ message: string }>) {
    try {
      onChanged((await action()).message);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
    detail.reload();
  }

  async function download() {
    const tab = window.open("", "_blank");
    try {
      const url = await payrollApi.exportUrl(token, periodId);
      if (tab) tab.location.href = url;
    } catch (caught) {
      tab?.close();
      onChanged(errorMessage(caught), "error");
    }
  }

  if (detail.error) return <FormAlert tone="error">{detail.error}</FormAlert>;
  if (!detail.data) return <p className="text-muted">Memuat…</p>;
  const { period, summary, pending_reports: pendingReports, requests, hosts, adjustments, slips } = detail.data;
  const locked = period.status === "requested" || period.status === "paid";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg text-heading font-medium">
              {period.brand?.name} · {formatDate(period.period_start)} – {formatDate(period.period_end)}
            </p>
            <PeriodBadge status={period.status} />
          </div>
          <div className="flex flex-wrap gap-2">
            {period.status === "waiting_payment" && (
              <button
                type="button"
                disabled={pendingReports > 0}
                onClick={() => confirm("Kunci periode ini dan ajukan pembayaran? Jam dan tarif akan dibekukan.") && act(() => payrollApi.requestPayment(token, period.id))}
                className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Ajukan pembayaran
              </button>
            )}
            {locked && (
              <button type="button" onClick={download} className="px-3 py-1.5 rounded-lg border border-stroke-strong text-body text-sm hover:bg-surface-2">
                Laporan brand (CSV)
              </button>
            )}
            {period.status === "requested" && (
              <button
                type="button"
                onClick={() => confirm("Brand sudah membayar? Slip gaji akan dibuat dan kasbon dipotong.") && act(() => payrollApi.markPaid(token, period.id))}
                className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-500"
              >
                Tandai lunas
              </button>
            )}
            {period.status === "requested" && (
              <InlineAction
                label="Batalkan pengajuan"
                placeholder="Kenapa? mis. jam host salah"
                submitLabel="Batalkan pengajuan"
                required
                buttonClass="px-3 py-1.5 rounded-lg border border-red-500/40 text-danger text-sm hover:bg-red-500/10"
                onSubmit={(reason) => act(() => payrollApi.cancelRequest(token, period.id, reason))}
              />
            )}
          </div>
        </div>

        {period.status !== "paid" && pendingReports > 0 && (
          <FormAlert tone="warning">
            {pendingReports} laporan live di periode ini masih menunggu dicek. Pembayaran
            bisa diajukan setelah operator menyetujui atau menolaknya.
          </FormAlert>
        )}

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Stat label="Target" value={`${summary.target_hours} jam`} />
          <Stat label="Jam kerja (semua host)" value={formatDuration(summary.worked_hours)} />
          <Stat label="Bawaan periode lalu" value={formatDuration(summary.carried_in_hours)} />
          <Stat label="Ditagihkan ke brand" value={formatDuration(summary.achieved_hours)} />
          <Stat label="Dibawa ke periode berikutnya" value={formatDuration(summary.carried_out_hours)} />
          <Stat label="Gaji host" value={formatRupiah(summary.total_amount)} />
        </dl>
        {period.status === "in_progress" && <p className="text-xs text-muted">Gaji masih perkiraan dengan tarif hari ini sampai pembayaran diajukan.</p>}
        {period.status === "requested" && (
          <p className="text-xs text-muted">
            Membatalkan akan membuka kunci periode supaya jam bisa dikoreksi; ajukan lagi setelahnya. Jam yang disetujui saat periode terkunci tetap di periode berikutnya.
          </p>
        )}
      </Card>

      {requests.some((request) => request.status === "cancelled") && (
        <Card title="Riwayat pengajuan">
          <ul className="space-y-2 text-sm">
            {requests.map((request) => (
              <li key={request.id} className="rounded-lg bg-surface-2 px-3 py-2">
                <p className="text-body">
                  Diajukan {formatDate(request.requested_at)}
                  {request.requester ? ` oleh ${request.requester.name}` : ""}
                  {request.status === "cancelled" ? (
                    <span className="text-danger">
                      {" "}
                      · dibatalkan {request.cancelled_at ? formatDate(request.cancelled_at) : ""}
                      {request.canceller ? ` oleh ${request.canceller.name}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted"> · {request.status === "paid" ? "lunas" : "aktif"}</span>
                  )}
                </p>
                {request.cancel_reason && <p className="text-xs text-muted">{request.cancel_reason}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Host">
        {hosts.length === 0 && <p className="text-sm text-muted">Belum ada jam yang disetujui.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-stroke">
              {hosts.map((host) => (
                <tr key={host.host_id} className="text-body">
                  <td className="py-2 text-heading">{host.name}</td>
                  <td className="py-2">
                    {host.session_count} sesi
                  </td>
                  <td className="py-2 whitespace-nowrap">{formatDuration(host.hours)}</td>
                  <td className="py-2 whitespace-nowrap text-muted">× {formatRupiah(host.rate_per_hour)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {formatRupiah(host.amount)}
                    {host.estimate && <span className="text-xs text-faint"> perkiraan</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Penyesuaian" description="Tambah atau kurangi waktu host, mis. live terpotong karena gangguan.">
        {adjustments.length === 0 && <p className="text-sm text-muted">Tidak ada.</p>}
        <ul className="space-y-2">
          {adjustments.map((adjustment) => (
            <li key={adjustment.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="text-heading">{adjustment.host.user.name}</span>
              <span className={adjustment.hours_added < 0 ? "text-danger" : "text-success"}>
                {adjustment.hours_added < 0 ? "−" : "+"}
                {formatDuration(Math.abs(adjustment.hours_added))}
                {adjustment.sessions_added !== 0 && `, ${adjustment.sessions_added > 0 ? "+" : ""}${adjustment.sessions_added} sesi`}
              </span>
              <span className="flex-1 min-w-32 text-muted">{adjustment.notes}</span>
              {!locked && (
                <button type="button" onClick={() => act(() => payrollApi.removeAdjustment(token, adjustment.id))} className="text-xs text-danger hover:text-danger">
                  Hapus
                </button>
              )}
            </li>
          ))}
        </ul>
        {!locked && <AdjustmentForm periodId={period.id} brandId={period.brand_id} onDone={(message) => act(async () => ({ message }))} />}
      </Card>

      {slips.length > 0 && (
        <Card title="Slip gaji">
          <ul className="space-y-2">
            {slips.map((slip) => (
              <li key={slip.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span className="flex-1 text-heading">{slip.host?.user.name}</span>
                <span className="text-muted">
                  {formatRupiah(slip.gross_amount)}
                  {slip.advance_deduction > 0 && ` − ${formatRupiah(slip.advance_deduction)} kasbon`}
                </span>
                {(slip.skipped_deductions?.length ?? 0) > 0 && <span className="text-xs text-warning">kasbon dilewati (gaji tidak cukup)</span>}
                <span className="font-medium text-success">{formatRupiah(slip.net_amount)}</span>
                <Link href={`${slipsPath}/${slip.id}`} className="text-xs text-accent hover:text-heading">
                  Lihat
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * A button that opens a one-field form (a reason, a note, a number) before running the action.
 */
function InlineAction({
  label,
  placeholder,
  submitLabel,
  type = "text",
  required = false,
  buttonClass,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  type?: "text" | "number";
  required?: boolean;
  buttonClass: string;
  onSubmit: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const missing = required && value.trim() === "";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        {label}
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (missing) return;
        onSubmit(value.trim());
        setOpen(false);
        setValue("");
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input
        autoFocus
        type={type}
        min={type === "number" ? 1 : undefined}
        max={type === "number" ? 24 : undefined}
        maxLength={type === "text" ? 255 : undefined}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`px-3 py-1.5 rounded-lg bg-surface-2 border border-stroke-strong text-heading text-sm ${type === "number" ? "w-28" : "min-w-56"}`}
      />
      <button type="submit" disabled={missing} className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm hover:bg-primary-hover disabled:opacity-50">
        {submitLabel}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-heading">
        Kembali
      </button>
    </form>
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

function AdjustmentForm({ periodId, brandId, onDone }: { periodId: string; brandId: string; onDone: (message: string) => void }) {
  const { token } = useAuth();
  const hosts = useApiData(`payroll-hosts-${brandId}`, () => payrollApi.hosts(token, brandId));
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hours, setHours] = useState(1);
  const input = "px-3 py-2 rounded-lg bg-surface-2 border border-stroke-strong text-heading";

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      payrollApi.addAdjustment(token, periodId, {
        host_id: formValue(data, "host_id"),
        sessions_added: direction * Number(formValue(data, "sessions") || 0),
        hours_added: direction * hours,
        notes: formValue(data, "notes"),
      }),
    ({ message }, form) => {
      form.reset();
      onDone(message);
    }
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2 border-t border-stroke pt-3" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <label className="space-y-1">
        <span className="block text-xs text-muted">Host</span>
        <select name="host_id" className={`${input} w-full`}>
          {hosts.data?.hosts.map((host) => (
            <option key={host.host_id} value={host.host_id}>
              {host.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-muted">Tambah atau kurangi</span>
        <select value={direction} onChange={(event) => setDirection(Number(event.target.value) as 1 | -1)} className={`${input} w-full`}>
          <option value={1}>Tambah waktu</option>
          <option value={-1}>Kurangi waktu</option>
        </select>
      </label>
      <DurationInput label="Waktu" hours={hours} onChange={setHours} error={errors.hours_added} compact />
      <label className="space-y-1">
        <span className="block text-xs text-muted">Sesi (opsional)</span>
        <input name="sessions" type="number" min={0} max={50} defaultValue={0} className={`${input} w-24`} />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="block text-xs text-muted">Alasan</span>
        <input name="notes" maxLength={255} className={`${input} w-full`} />
        {errors.notes && <span className="block text-xs text-danger">{errors.notes}</span>}
      </label>
      <div className="w-44">
        <SubmitButton loading={loading}>Simpan penyesuaian</SubmitButton>
      </div>
    </form>
  );
}

const advanceTypes = { early_payment: "Gaji di muka", loan: "Pinjaman" } as const;

function installmentColor(installment: CashAdvance["installments"][number]): string {
  if (installment.status === "deducted") return "bg-green-500";
  if (installment.status === "settled") return "bg-blue-400";
  return installment.skip_count > 0 ? "bg-yellow-500" : "bg-surface-3";
}

function Kasbon() {
  const { token } = useAuth();
  const [status, setStatus] = useState<"open" | "paid" | "">("open");
  const advances = useApiData(`advances-${status}`, () => payrollApi.advances(token, status));
  const [notice, setNotice] = useState<Notice>(null);
  const [creating, setCreating] = useState(false);

  async function act(action: () => Promise<{ message: string }>) {
    setNotice(null);
    try {
      setNotice({ tone: "success", text: (await action()).message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    }
    advances.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          aria-label="Status"
          className="px-3 py-2 rounded-lg bg-surface border border-stroke text-heading"
        >
          <option value="open">Masih dicicil</option>
          <option value="paid">Sudah lunas</option>
          <option value="">Semua</option>
        </select>
        <button type="button" onClick={() => setCreating(true)} className="px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary-hover">
          Catat kasbon
        </button>
      </div>

      {creating && (
        <AdvanceForm
          onDone={(message) => {
            setCreating(false);
            act(async () => ({ message }));
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {advances.error && <FormAlert tone="error">{advances.error}</FormAlert>}

      {advances.data?.advances.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Tidak ada kasbon.</p>
        </Card>
      )}
      {advances.data?.advances.map((advance) => {
        const paidCount = advance.installments.filter((installment) => installment.status !== "scheduled").length;
        const skipped = advance.installments.find((installment) => installment.status === "scheduled" && installment.skip_count > 0);

        return (
          <Card key={advance.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-heading font-medium">
                  {advance.host.user.name} · {formatRupiah(advance.total_amount)}
                </p>
                <p className="text-xs text-muted">
                  {advanceTypes[advance.type]} · {formatDate(advance.requested_at)}
                  {advance.brand ? ` · ${advance.brand.name}` : ""}
                  {advance.notes ? ` · ${advance.notes}` : ""}
                </p>
              </div>
              <span className="text-sm text-body">
                {paidCount}/{advance.installment_count} cicilan · sisa {formatRupiah(advance.remaining_amount)}
              </span>
            </div>
            <div className="flex gap-1">
              {advance.installments.map((installment) => (
                <span
                  key={installment.id}
                  title={`${installment.seq}: ${formatRupiah(installment.amount)}${installment.skip_count > 0 ? ` · dilewati ${installment.skip_count}×` : ""}`}
                  className={`h-2 flex-1 rounded-full ${installmentColor(installment)}`}
                />
              ))}
            </div>
            {skipped && (
              <p className="text-xs text-warning">
                Cicilan {skipped.seq} ({formatRupiah(skipped.amount)}) dilewati di {skipped.skip_count} slip karena gaji tidak
                cukup. Pertimbangkan menjadwal ulang jadi cicilan yang lebih kecil.
              </p>
            )}
            {advance.settled_at && (
              <p className="text-xs text-muted">
                Dilunasi langsung pada {formatDate(advance.settled_at)}
                {advance.settler ? ` (dicatat oleh ${advance.settler.name})` : ""}
                {advance.settled_note ? ` · ${advance.settled_note}` : ""}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {advance.status !== "paid" && (
                <>
                  <InlineAction
                    label="Dilunasi langsung"
                    placeholder="Catatan (opsional), mis. tunai tgl 3 Okt"
                    submitLabel="Tandai lunas"
                    buttonClass="text-xs text-success hover:text-success"
                    onSubmit={(note) => act(() => payrollApi.settleAdvance(token, advance.id, note || null))}
                  />
                  <InlineAction
                    label="Jadwal ulang"
                    placeholder="Jumlah cicilan"
                    submitLabel="Bagi sisanya"
                    type="number"
                    required
                    buttonClass="text-xs text-accent hover:text-heading"
                    onSubmit={(count) => act(() => payrollApi.rescheduleAdvance(token, advance.id, Number(count)))}
                  />
                </>
              )}
              {paidCount === 0 && (
                <button
                  type="button"
                  onClick={() => confirm("Hapus kasbon ini?") && act(() => payrollApi.removeAdvance(token, advance.id))}
                  className="text-xs text-danger hover:text-danger"
                >
                  Hapus (salah catat)
                </button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function AdvanceForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const hosts = useApiData("payroll-hosts-all", () => payrollApi.hosts(token));
  const input = "w-full px-3 py-2 rounded-lg bg-surface-2 border border-stroke-strong text-heading";

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      payrollApi.createAdvance(token, {
        host_id: formValue(data, "host_id"),
        type: formValue(data, "type") as "early_payment" | "loan",
        total_amount: Number(formValue(data, "total_amount")),
        installment_count: Number(formValue(data, "installment_count")),
        notes: formValue(data, "notes") || null,
      }),
    ({ message }) => onDone(message)
  );

  return (
    <Modal title="Catat kasbon" description="Dicicil sama rata dari slip gaji host berikutnya (brand apa pun)." onClose={onCancel}>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <label className="space-y-1">
          <span className="block text-xs text-muted">Host</span>
          <select name="host_id" className={input}>
            {hosts.data?.hosts.map((host) => (
              <option key={host.host_id} value={host.host_id}>
                {host.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted">Jenis</span>
          <select name="type" className={input}>
            <option value="loan">Pinjaman</option>
            <option value="early_payment">Gaji di muka</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted">Jumlah (Rp)</span>
          <input name="total_amount" type="number" min={1000} step={1000} className={input} />
          {errors.total_amount && <span className="block text-xs text-danger">{errors.total_amount}</span>}
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted">Jumlah cicilan</span>
          <input name="installment_count" type="number" min={1} max={24} defaultValue={1} className={input} />
          {errors.installment_count && <span className="block text-xs text-danger">{errors.installment_count}</span>}
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="block text-xs text-muted">Catatan</span>
          <input name="notes" maxLength={255} className={input} />
        </label>
        <div className="sm:col-span-2 flex gap-3">
          <div className="w-40">
            <SubmitButton loading={loading}>Catat</SubmitButton>
          </div>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-body hover:bg-surface-2">
            Batal
          </button>
        </div>
      </form>
    </Modal>
  );
}
