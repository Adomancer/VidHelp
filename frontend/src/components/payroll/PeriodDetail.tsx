"use client";

import { useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight, Download, Lock, Plus, Send, Wallet } from "lucide-react";
import { errorMessage, payrollApi, type HostPayRow } from "@/lib/api";
import { formatDate, formatDuration, formatRupiah } from "@/lib/format";
import { inputClass, inputSmClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "../AuthProvider";
import Card from "../Card";
import ConfirmDialog from "../ConfirmDialog";
import DataTable from "../DataTable";
import DurationInput from "../DurationInput";
import ErrorState from "../ErrorState";
import { FieldError } from "../FieldMessage";
import FormAlert from "../FormAlert";
import { CardsSkeleton } from "../Loading";
import { NativeSelect } from "../SelectField";
import StatusBadge from "../StatusBadge";
import SubmitButton from "../SubmitButton";
import ToggleGroup, { ShortLabel } from "../ToggleGroup";
import { type Confirm, useCanManageFinance } from "./shared";

/**
 * Hosts' pay in a period: name, sessions, time worked and paid, rate and pay, sortable.
 * Paid time = carried in + worked − what carried over the brand's target.
 */
const hostPayColumns: ColumnDef<HostPayRow>[] = [
  {
    accessorKey: "name",
    header: "Host",
    meta: { headClassName: "px-5 py-2.5 md:px-6", cellClassName: "px-5 py-2.5 md:px-6" },
    cell: ({ row: { original: host } }) => (
      <>
        <span className="font-medium text-foreground">{host.name}</span>
        {host.host_paid.map((cover) => (
          <span key={cover.payer} className="block text-[11px] text-muted-foreground">
            Backup {formatDuration(cover.hours)} dibayar langsung oleh {cover.payer}
          </span>
        ))}
      </>
    ),
  },
  { accessorKey: "session_count", header: "Sesi", meta: { align: "right", headClassName: "px-3 py-2.5", cellClassName: "px-3 py-2.5" } },
  {
    accessorKey: "worked_hours",
    header: "Kerja",
    meta: {
      align: "right",
      headClassName: "hidden px-3 py-2.5 sm:table-cell",
      cellClassName: "hidden px-3 py-2.5 whitespace-nowrap text-muted-foreground sm:table-cell",
    },
    cell: ({ row }) => formatDuration(row.original.worked_hours),
  },
  {
    accessorKey: "hours",
    header: "Dibayar",
    meta: { align: "right", headClassName: "px-3 py-2.5", cellClassName: "px-3 py-2.5 whitespace-nowrap" },
    cell: ({ row: { original: host } }) => (
      <>
        {formatDuration(host.hours)}
        {host.carried_in_hours > 0 && <span className="block text-[11px] text-muted-foreground">+{formatDuration(host.carried_in_hours)} bawaan</span>}
        {host.carried_out_hours > 0 && <span className="block text-[11px] text-warning">{formatDuration(host.carried_out_hours)} dibawa</span>}
      </>
    ),
  },
  {
    accessorKey: "rate_per_hour",
    header: "Tarif",
    meta: {
      align: "right",
      headClassName: "hidden px-3 py-2.5 sm:table-cell",
      cellClassName: "hidden px-3 py-2.5 whitespace-nowrap text-muted-foreground sm:table-cell",
    },
    cell: ({ row }) => formatRupiah(row.original.rate_per_hour),
  },
  {
    accessorKey: "amount",
    header: "Gaji",
    meta: { align: "right", headClassName: "px-5 py-2.5 md:px-6", cellClassName: "px-5 py-2.5 whitespace-nowrap md:px-6" },
    cell: ({ row: { original: host } }) => (
      <>
        <span className="font-medium text-foreground">{formatRupiah(host.amount)}</span>
        {host.estimate && <span className="block text-[11px] text-muted-foreground">perkiraan</span>}
      </>
    ),
  },
];

export function PeriodDetail({ periodId, onChanged }: { periodId: string; onChanged: (text: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`payroll-period-${periodId}`, () => payrollApi.period(token, periodId));
  const canManage = useCanManageFinance();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [paying, setPaying] = useState(false);
  const [reference, setReference] = useState("");
  const slipsPath = "/admin/payroll/slips";

  async function act(action: () => Promise<{ message: string }>) {
    try {
      onChanged((await action()).message);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
    detail.reload();
  }

  async function download() {
    if (!detail.data) return;
    try {
      await payrollApi.exportPeriod(token, detail.data.period);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
  }

  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <CardsSkeleton count={2} />;
  const { period, summary, pending_reports: pendingReports, pending_letters: pendingLetters, requests, hosts, adjustments, slips } = detail.data;
  const locked = period.status === "requested" || period.status === "paid";
  const hasActions = (canManage && (period.status === "in_progress" || period.status === "waiting_payment" || period.status === "requested")) || locked;
  const paymentReference = period.payment_request?.payment_reference;

  return (
    <div className="space-y-4">
      <Card>
        {/* What can be done with this period now, first */}
        {hasActions && (
          <div className="flex flex-wrap gap-2">
            {canManage && period.status === "in_progress" && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setConfirm({
                    title: "Tutup periode sebelum target?",
                    body: `Baru ${formatDuration(summary.carried_in_hours + summary.worked_hours)} dari ${summary.target_hours} jam. Pakai ini kalau brand berhenti live: periode berakhir hari ini, PIC brand bisa mengajukan pembayaran untuk jam yang ada, dan periode baru dimulai besok.`,
                    label: "Tutup periode",
                    destructive: false,
                    run: () => payrollApi.closePeriod(token, period.id),
                  })
                }
              >
                <Lock aria-hidden="true" />
                Tutup periode
              </Button>
            )}
            {canManage && period.status === "waiting_payment" && (
              <Button
                type="button"
                variant="outline"
                disabled={pendingReports > 0 || pendingLetters > 0}
                onClick={() =>
                  setConfirm({
                    title: "Ajukan atas nama PIC?",
                    body: "Biasanya leader brand yang mengajukan dari aplikasinya. Periode ini dikunci: jam dan tarif host dibekukan, dan laporan brand dibuat.",
                    label: "Kunci dan ajukan",
                    destructive: false,
                    run: () => payrollApi.requestPayment(token, period.id),
                  })
                }
              >
                <Send aria-hidden="true" />
                Ajukan atas nama PIC
              </Button>
            )}
            {locked && (
              <Button type="button" variant="outline" onClick={download}>
                <Download aria-hidden="true" />
                Laporan brand (Excel)
              </Button>
            )}
            {canManage && period.status === "requested" && (
              <Button type="button" variant="success" onClick={() => setPaying(true)}>
                <Wallet aria-hidden="true" />
                Tandai lunas
              </Button>
            )}
            {canManage && period.status === "requested" && (
              <InlineAction
                label="Batalkan pengajuan"
                placeholder="Kenapa? mis. jam host salah"
                submitLabel="Batalkan pengajuan"
                required
                destructive
                onSubmit={(reason) => act(() => payrollApi.cancelRequest(token, period.id, reason))}
              />
            )}
          </div>
        )}

        {period.status === "in_progress" && (
          <FormAlert tone="info">
            Berjalan sampai target {summary.target_hours} jam tercapai: kurang{" "}
            {formatDuration(Math.max(0, summary.target_hours - summary.carried_in_hours - summary.worked_hours))}. Setelah itu leader brand (PIC) mengajukan
            pembayaran.
          </FormAlert>
        )}
        {period.status === "waiting_payment" && (
          <FormAlert tone="warning">
            {period.closer ? `Ditutup lebih awal oleh ${period.closer.name}.` : "Target tercapai."} Menunggu leader brand (PIC) mengajukan pembayaran.
          </FormAlert>
        )}

        {period.status !== "paid" && pendingReports > 0 && (
          <FormAlert tone="warning">
            {pendingReports} laporan live di periode ini masih menunggu dicek. Pembayaran bisa diajukan setelah operator menyetujui atau menolaknya.
          </FormAlert>
        )}
        {period.status !== "paid" && pendingLetters > 0 && (
          <FormAlert tone="warning">
            {pendingLetters} sesi backup karena sakit masih menunggu surat dokter. Kalau surat masuk tepat waktu agensi yang membayar penggantinya; kalau tidak,
            host yang minta backup. Pembayaran bisa diajukan setelah suratnya masuk atau batas waktunya lewat.
          </FormAlert>
        )}

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm sm:grid-cols-3">
          <Stat label="Target" value={`${summary.target_hours} jam`} />
          <Stat label="Jam kerja (semua host)" value={formatDuration(summary.worked_hours)} />
          <Stat label="Bawaan periode lalu" value={formatDuration(summary.carried_in_hours)} />
          <Stat label="Ditagihkan ke brand" value={formatDuration(summary.achieved_hours)} />
          <Stat label="Dibawa ke periode berikutnya" value={formatDuration(summary.carried_out_hours)} />
          <Stat label="Gaji host" value={formatRupiah(summary.total_amount)} strong />
        </dl>
        <p className="text-xs text-muted-foreground">
          Host dibayar untuk jam yang ditagihkan: bawaan periode lalu dulu, lalu jam periode ini sampai target. Jam di atas target dibawa ke periode berikutnya,
          dipotong sama rata dari semua host.
          {summary.host_paid_hours > 0 &&
            ` ${formatDuration(summary.host_paid_hours)} backup dibayar langsung oleh host yang minta backup: ikut ditagihkan, tapi tidak masuk gaji.`}
        </p>
        {period.status === "in_progress" && (
          <p className="text-xs text-muted-foreground">Gaji masih perkiraan dengan tarif hari ini sampai pembayaran diajukan.</p>
        )}
        {paymentReference && <p className="text-xs text-muted-foreground">Referensi transfer brand: {paymentReference}</p>}
        {period.status === "requested" && (
          <p className="text-xs text-muted-foreground">
            Membatalkan akan membuka kunci periode supaya jam bisa dikoreksi; ajukan lagi setelahnya. Jam yang disetujui saat periode terkunci tetap di periode
            berikutnya.
          </p>
        )}
      </Card>

      {requests.some((request) => request.status === "cancelled") && (
        <Card title="Riwayat pengajuan">
          <ul className="divide-y divide-border text-sm">
            {requests.map((request) => (
              <li key={request.id} className="py-2.5 first:pt-0 last:pb-0">
                <p className="text-body">
                  Diajukan {formatDate(request.requested_at)}
                  {request.requester ? ` oleh ${request.requester.name}` : ""}
                  {request.status === "cancelled" ? (
                    <span className="text-destructive">
                      {" "}
                      · dibatalkan {request.cancelled_at ? formatDate(request.cancelled_at) : ""}
                      {request.canceller ? ` oleh ${request.canceller.name}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {" "}
                      · {request.status === "paid" ? "lunas" : "aktif"}
                      {request.payment_reference ? ` · ref ${request.payment_reference}` : ""}
                    </span>
                  )}
                </p>
                {request.cancel_reason && <p className="text-xs text-muted-foreground">{request.cancel_reason}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Host" bodyClassName="px-0 pb-2 md:px-0">
        {hosts.length === 0 ? (
          <p className="px-5 pb-3 text-sm text-muted-foreground md:px-6">Belum ada jam yang disetujui.</p>
        ) : (
          <DataTable
            columns={hostPayColumns}
            data={hosts}
            getRowId={(host) => host.host_id}
            headerClassName="border-y"
            rowClassName={() => "text-body"}
            renderMobile={(host) => (
              <div className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{host.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {host.session_count} sesi · dibayar {formatDuration(host.hours)}
                  </p>
                  {host.carried_in_hours > 0 && <p className="text-[11px] text-muted-foreground">+{formatDuration(host.carried_in_hours)} bawaan</p>}
                  {host.carried_out_hours > 0 && <p className="text-[11px] text-warning">{formatDuration(host.carried_out_hours)} dibawa</p>}
                  {host.host_paid.map((cover) => (
                    <p key={cover.payer} className="text-[11px] text-muted-foreground">
                      Backup {formatDuration(cover.hours)} dibayar langsung oleh {cover.payer}
                    </p>
                  ))}
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p className="font-medium text-foreground">{formatRupiah(host.amount)}</p>
                  {host.estimate && <p className="text-[11px] text-muted-foreground">perkiraan</p>}
                </div>
              </div>
            )}
          />
        )}
      </Card>

      <Card title="Penyesuaian" description="Tambah atau kurangi waktu host, mis. live terpotong karena gangguan.">
        {adjustments.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada penyesuaian.</p>}
        <ul className="space-y-2">
          {adjustments.map((adjustment) => (
            <li key={adjustment.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
              <span className="font-medium text-foreground">{adjustment.host.user.name}</span>
              <StatusBadge tone={adjustment.hours_added < 0 ? "danger" : "success"} className="tabular-nums">
                {adjustment.hours_added < 0 ? "−" : "+"}
                {formatDuration(Math.abs(adjustment.hours_added))}
                {adjustment.sessions_added !== 0 && `, ${adjustment.sessions_added > 0 ? "+" : ""}${adjustment.sessions_added} sesi`}
              </StatusBadge>
              <span className="min-w-32 flex-1 text-muted-foreground">{adjustment.notes}</span>
              {canManage && !locked && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setConfirm({
                      title: "Hapus penyesuaian?",
                      body: `${adjustment.host.user.name}: ${adjustment.hours_added < 0 ? "−" : "+"}${formatDuration(Math.abs(adjustment.hours_added))}${adjustment.notes ? ` (${adjustment.notes})` : ""}. Jam di periode ini dihitung ulang tanpa penyesuaian ini.`,
                      label: "Hapus",
                      run: () => payrollApi.removeAdjustment(token, adjustment.id),
                    })
                  }
                  className="text-destructive hover:text-destructive max-md:h-10 max-md:px-3"
                >
                  Hapus
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canManage && !locked && <AdjustmentForm periodId={period.id} brandId={period.brand_id} onDone={(message) => act(async () => ({ message }))} />}
      </Card>

      {slips.length > 0 && (
        <Card title="Slip gaji" bodyClassName="px-0 pb-2 md:px-0">
          <ul className="divide-y divide-border border-t border-border">
            {slips.map((slip) => (
              <li key={slip.id}>
                <Link
                  href={`${slipsPath}/${slip.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50 md:px-6"
                >
                  <span className="min-w-32 flex-1 font-medium text-foreground">{slip.host?.user.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatRupiah(slip.gross_amount)}
                    {slip.advance_deduction > 0 && ` − ${formatRupiah(slip.advance_deduction)} kasbon`}
                  </span>
                  {(slip.skipped_deductions?.length ?? 0) > 0 && <StatusBadge tone="warning">kasbon dilewati</StatusBadge>}
                  <span className="font-semibold text-foreground tabular-nums">{formatRupiah(slip.net_amount)}</span>
                  <ChevronRight className="size-4 text-faint" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          confirmLabel={confirm.label}
          destructive={confirm.destructive ?? true}
          onConfirm={() => act(confirm.run)}
          onClose={() => setConfirm(null)}
        >
          {confirm.body}
        </ConfirmDialog>
      )}

      {paying && (
        <ConfirmDialog
          title="Brand sudah membayar?"
          confirmLabel="Tandai lunas"
          destructive={false}
          onConfirm={() => act(() => payrollApi.markPaid(token, period.id, reference.trim() || null))}
          onClose={() => {
            setPaying(false);
            setReference("");
          }}
        >
          <div className="space-y-3">
            <p>Slip gaji dibuat untuk setiap host yang dibayar di periode ini, dan cicilan kasbon dipotong.</p>
            <div className="space-y-1.5">
              <Label htmlFor={`paid-reference-${period.id}`}>
                Nomor referensi transfer <span className="font-normal text-muted-foreground">(opsional)</span>
              </Label>
              <input
                id={`paid-reference-${period.id}`}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                maxLength={100}
                placeholder="mis. nomor referensi dari mutasi rekening"
                className={inputClass}
              />
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * A button that opens a one-field form (a reason, a note, a number) before running the action.
 */
export function InlineAction({
  label,
  placeholder,
  submitLabel,
  type = "text",
  required = false,
  destructive = false,
  small = false,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  type?: "text" | "number";
  required?: boolean;
  destructive?: boolean;
  small?: boolean;
  onSubmit: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const missing = required && value.trim() === "";

  if (!open) {
    return (
      <Button
        type="button"
        variant={small ? "ghost" : "outline"}
        size={small ? "xs" : "default"}
        onClick={() => setOpen(true)}
        className={cn(destructive && "text-destructive hover:text-destructive")}
      >
        {label}
      </Button>
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
      className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
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
        className={cn(inputSmClass, type === "number" ? "w-32" : "min-w-56 flex-1")}
      />
      <Button type="submit" size="sm" variant={destructive ? "danger" : "default"} disabled={missing}>
        {submitLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Kembali
      </Button>
    </form>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="bg-card px-3.5 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 tabular-nums", strong ? "text-base font-semibold text-foreground" : "font-medium text-foreground")}>{value}</dd>
    </div>
  );
}

function AdjustmentForm({ periodId, brandId, onDone }: { periodId: string; brandId: string; onDone: (message: string) => void }) {
  const { token } = useAuth();
  const hosts = useApiData(`payroll-hosts-${brandId}`, () => payrollApi.hosts(token, brandId));
  const [direction, setDirection] = useState<1 | -1>(1);
  const [hours, setHours] = useState(1);

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      payrollApi.addAdjustment(token, periodId, {
        host_id: formValue(data, "host_id"),
        sessions_added: direction * Number(formValue(data, "sessions") || 0),
        hours_added: direction * hours,
        notes: formValue(data, "notes"),
      }),
    ({ message }, form) => {
      // The next entry starts from scratch: direction and time are state, not inputs form.reset() clears
      form.reset();
      setDirection(1);
      setHours(1);
      onDone(message);
    },
    ["hours_added", "sessions_added"]
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`adjust-host-${periodId}`}>Host</Label>
        {hosts.error && <ErrorState message={hosts.error} onRetry={hosts.reload} />}
        <NativeSelect id={`adjust-host-${periodId}`} name="host_id" disabled={!hosts.data}>
          {hosts.data?.hosts.map((host) => (
            <option key={host.host_id} value={host.host_id}>
              {host.name}
            </option>
          ))}
        </NativeSelect>
        <FieldError>{errors.host_id}</FieldError>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Tambah atau kurangi</p>
        <ToggleGroup
          label="Tambah atau kurangi"
          options={
            [
              { value: "1", label: <ShortLabel short="Tambah" full="Tambah waktu" /> },
              { value: "-1", label: <ShortLabel short="Kurangi" full="Kurangi waktu" /> },
            ] as const
          }
          value={String(direction) as "1" | "-1"}
          onChange={(value) => setDirection(Number(value) as 1 | -1)}
          className="grid w-full grid-cols-2"
        />
      </div>
      <DurationInput label="Waktu" hours={hours} onChange={setHours} error={errors.hours_added} />
      <div className="space-y-1.5">
        <Label htmlFor={`adjust-sessions-${periodId}`}>
          Sesi <span className="font-normal text-muted-foreground">(opsional)</span>
        </Label>
        <input
          id={`adjust-sessions-${periodId}`}
          name="sessions"
          type="number"
          min={0}
          max={50}
          defaultValue={0}
          className={cn(inputClass, "w-28 tabular-nums")}
        />
        <FieldError>{errors.sessions_added}</FieldError>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`adjust-notes-${periodId}`}>Alasan</Label>
        <input id={`adjust-notes-${periodId}`} name="notes" maxLength={255} className={inputClass} />
        <FieldError>{errors.notes}</FieldError>
      </div>
      <div className="flex justify-end sm:col-span-2">
        <SubmitButton loading={loading} size="default" className="sm:w-auto">
          <Plus aria-hidden="true" />
          Simpan penyesuaian
        </SubmitButton>
      </div>
    </form>
  );
}
