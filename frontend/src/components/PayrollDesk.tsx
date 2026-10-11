"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarRange, ChevronRight, Download, HandCoins, Plus, Send, Wallet } from "lucide-react";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { errorMessage, payrollApi, type CashAdvance, type HostPayRow, type PeriodListItem, type PeriodStatus } from "@/lib/api";
import { formatDate, formatDuration, formatRupiah } from "@/lib/format";
import { inputClass, inputSmClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import ConfirmDialog from "./ConfirmDialog";
import DataTable from "./DataTable";
import Dialog from "./Dialog";
import DurationInput from "./DurationInput";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import { FieldError } from "./FieldMessage";
import FormActions from "./FormActions";
import FormAlert from "./FormAlert";
import { CardsSkeleton, RefreshBar, TableSkeleton } from "./Loading";
import Modal from "./Modal";
import RupiahInput from "./RupiahInput";
import { NativeSelect } from "./SelectField";
import StatusBadge, { type Tone } from "./StatusBadge";
import SubmitButton from "./SubmitButton";
import { notify } from "./Toast";
import ToggleGroup from "./ToggleGroup";

const statusStyles: Record<PeriodStatus, [string, Tone]> = {
  in_progress: ["Berjalan", "info"],
  waiting_payment: ["Siap ditagihkan", "warning"],
  requested: ["Menunggu brand", "brand"],
  paid: ["Lunas", "success"],
};

export function PeriodBadge({ status }: { status: PeriodStatus }) {
  const [label, tone] = statusStyles[status];
  return (
    <StatusBadge tone={tone} dot>
      {label}
    </StatusBadge>
  );
}

type Confirm = { title: string; body: string; label: string; destructive?: boolean; run: () => Promise<{ message: string }> } | null;

/**
 * Admin payroll: payment periods per brand (lock, pay, slips) and kasbon.
 * The tab, brand filter, open period and kasbon filter live in the URL, so a refresh,
 * a shared link or coming back from a slip shows the same view.
 */
export default function PayrollDesk() {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(["periods", "kasbon"] as const).withDefault("periods"));

  return (
    <div className="space-y-5">
      <ToggleGroup
        label="Bagian penggajian"
        options={[
          ["periods", "Periode pembayaran"],
          ["kasbon", "Kasbon"],
        ] as const}
        value={tab}
        onChange={(next) => void setTab(next)}
      />
      {tab === "periods" ? <Periods /> : <Kasbon />}
    </div>
  );
}

function Periods() {
  const { token } = useAuth();
  const brands = useApiData("payroll-brands", () => payrollApi.brands(token));
  const [brandId, setBrandId] = useQueryState("brand", parseAsString.withDefault(""));
  const periods = useApiData(`payroll-periods-${brandId}`, () => payrollApi.periods(token, brandId));
  const [error, setError] = useState<string | null>(null);
  const list = periods.data?.periods;

  const [selected, setSelected] = useQueryState("period");
  const select = (id: string | null) => void setSelected(id);
  const current = list?.find((period) => period.id === selected);

  const withoutStart = brands.data?.brands.filter((brand) => brand.status === "active" && !brand.payroll_start_date) ?? [];

  return (
    <div className="space-y-4">
      {withoutStart.length > 0 && (
        <FormAlert tone="warning">
          Belum ada tanggal mulai penggajian untuk {withoutStart.map((brand) => brand.name).join(", ")}. Admin mengaturnya di halaman Brand supaya
          jam mereka masuk ke periode.
        </FormAlert>
      )}
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {periods.error && <ErrorState message={periods.error} onRetry={periods.reload} />}

      <NativeSelect
        wrapperClassName="sm:w-64"
        value={brandId}
        onChange={(event) => void setBrandId(event.target.value)}
        aria-label="Brand"
      >
        <option value="">Semua brand</option>
        {brands.data?.brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </NativeSelect>

      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <RefreshBar active={periods.loading && Boolean(list)} />
        {!list && !periods.error && <TableSkeleton rows={5} columns={5} />}
        {list?.length === 0 && <EmptyState icon={CalendarRange} title="Belum ada periode pembayaran" description="Periode dibuat otomatis setelah brand punya tanggal mulai penggajian." />}

        {list && list.length > 0 && (
          <DataTable
            columns={periodColumns}
            data={list}
            getRowId={(period) => period.id}
            onRowClick={(period) => select(period.id)}
            rowOpensDialog
            rowClassName={(period) => cn("text-body", period.id === selected ? "bg-primary/[0.06] [&_svg]:text-brand" : "hover:bg-muted/40")}
            renderMobile={(period) => (
              <button
                type="button"
                onClick={() => select(period.id)}
                className={cn("w-full space-y-2 p-4 text-left outline-none focus-visible:bg-muted/60", period.id === selected ? "bg-primary/[0.06]" : "active:bg-muted/60")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{period.brand?.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(period.period_start)} – {formatDate(period.period_end)} · {period.hosts} host
                    </p>
                  </div>
                  <PeriodBadge status={period.status} />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                  <span>
                    {formatDuration(period.achieved_hours)} / {period.target_hours} jam
                  </span>
                  <span className="text-sm font-semibold text-foreground">{formatRupiah(period.total_amount)}</span>
                </div>
              </button>
            )}
          />
        )}
      </div>

      {selected && (
        <Dialog
          placement="side"
          size="xl"
          onClose={() => select(null)}
          title={current ? `${current.brand?.name} · ${formatDate(current.period_start)} – ${formatDate(current.period_end)}` : "Periode pembayaran"}
          description={current && <PeriodBadge status={current.status} />}
        >
          <PeriodDetail
            key={selected}
            periodId={selected}
            onChanged={(text, tone = "success") => {
              if (tone === "success") notify({ text });
              else setError(text);
              periods.reload();
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

const statusOrder: PeriodStatus[] = ["in_progress", "waiting_payment", "requested", "paid"];

/** Sorting by "Brand · periode" goes by brand, then by start date. */
const periodColumns: ColumnDef<PeriodListItem>[] = [
  {
    id: "period",
    accessorFn: (period) => `${period.brand?.name ?? ""} ${period.period_start}`,
    header: "Brand · periode",
    cell: ({ row: { original: period } }) => (
      <>
        <p className="font-medium text-foreground">{period.brand?.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatDate(period.period_start)} – {formatDate(period.period_end)} · {period.hosts} host
        </p>
      </>
    ),
  },
  { id: "status", accessorFn: (period) => statusOrder.indexOf(period.status), header: "Status", cell: ({ row }) => <PeriodBadge status={row.original.status} /> },
  {
    accessorKey: "worked_hours",
    header: "Jam kerja",
    meta: { align: "right", cellClassName: "whitespace-nowrap" },
    cell: ({ row }) => formatDuration(row.original.worked_hours),
  },
  {
    accessorKey: "achieved_hours",
    header: "Ditagihkan",
    meta: { align: "right", cellClassName: "whitespace-nowrap" },
    cell: ({ row: { original: period } }) => (
      <>
        {formatDuration(period.achieved_hours)} <span className="text-xs text-muted-foreground">/ {period.target_hours} jam</span>
      </>
    ),
  },
  {
    accessorKey: "total_amount",
    header: "Gaji host",
    meta: { align: "right", cellClassName: "font-medium whitespace-nowrap text-foreground" },
    cell: ({ row }) => formatRupiah(row.original.total_amount),
  },
  {
    id: "open",
    header: () => <span className="sr-only">Buka</span>,
    enableSorting: false,
    meta: { headClassName: "w-10" },
    cell: () => <ChevronRight className="ml-auto size-4 text-faint" aria-hidden="true" />,
  },
];

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
    meta: { align: "right", headClassName: "hidden px-3 py-2.5 sm:table-cell", cellClassName: "hidden px-3 py-2.5 whitespace-nowrap text-muted-foreground sm:table-cell" },
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
    meta: { align: "right", headClassName: "hidden px-3 py-2.5 sm:table-cell", cellClassName: "hidden px-3 py-2.5 whitespace-nowrap text-muted-foreground sm:table-cell" },
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

function PeriodDetail({ periodId, onChanged }: { periodId: string; onChanged: (text: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`payroll-period-${periodId}`, () => payrollApi.period(token, periodId));
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [paying, setPaying] = useState(false);
  const [reference, setReference] = useState("");
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

  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <CardsSkeleton count={2} />;
  const { period, summary, pending_reports: pendingReports, pending_letters: pendingLetters, requests, hosts, adjustments, slips } = detail.data;
  const locked = period.status === "requested" || period.status === "paid";
  const hasActions = period.status === "waiting_payment" || locked;
  const paymentReference = period.payment_request?.payment_reference;

  return (
    <div className="space-y-4">
      <Card>
        {/* What can be done with this period now, first */}
        {hasActions && (
          <div className="flex flex-wrap gap-2">
            {period.status === "waiting_payment" && (
              <Button
                type="button"
                disabled={pendingReports > 0 || pendingLetters > 0}
                onClick={() =>
                  setConfirm({
                    title: "Ajukan pembayaran?",
                    body: "Periode ini dikunci: jam dan tarif host dibekukan, dan laporan brand dibuat.",
                    label: "Kunci dan ajukan",
                    destructive: false,
                    run: () => payrollApi.requestPayment(token, period.id),
                  })
                }
              >
                <Send aria-hidden="true" />
                Ajukan pembayaran
              </Button>
            )}
            {locked && (
              <Button type="button" variant="outline" onClick={download}>
                <Download aria-hidden="true" />
                Laporan brand (CSV)
              </Button>
            )}
            {period.status === "requested" && (
              <Button type="button" variant="success" onClick={() => setPaying(true)}>
                <Wallet aria-hidden="true" />
                Tandai lunas
              </Button>
            )}
            {period.status === "requested" && (
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

        {period.status !== "paid" && pendingReports > 0 && (
          <FormAlert tone="warning">
            {pendingReports} laporan live di periode ini masih menunggu dicek. Pembayaran bisa diajukan setelah operator menyetujui atau menolaknya.
          </FormAlert>
        )}
        {period.status !== "paid" && pendingLetters > 0 && (
          <FormAlert tone="warning">
            {pendingLetters} sesi backup karena sakit masih menunggu surat dokter. Kalau surat masuk tepat waktu agensi yang membayar penggantinya; kalau tidak, host yang
            minta backup. Pembayaran bisa diajukan setelah suratnya masuk atau batas waktunya lewat.
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
        {period.status === "in_progress" && <p className="text-xs text-muted-foreground">Gaji masih perkiraan dengan tarif hari ini sampai pembayaran diajukan.</p>}
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
          <DataTable columns={hostPayColumns} data={hosts} getRowId={(host) => host.host_id} headerClassName="border-y" rowClassName={() => "text-body"} />
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
              {!locked && (
                <Button type="button" variant="ghost" size="xs" onClick={() => act(() => payrollApi.removeAdjustment(token, adjustment.id))} className="text-destructive hover:text-destructive">
                  Hapus
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!locked && <AdjustmentForm periodId={period.id} brandId={period.brand_id} onDone={(message) => act(async () => ({ message }))} />}
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
function InlineAction({
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
      form.reset();
      onDone(message);
    }
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
        <NativeSelect id={`adjust-host-${periodId}`} name="host_id">
          {hosts.data?.hosts.map((host) => (
            <option key={host.host_id} value={host.host_id}>
              {host.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Tambah atau kurangi</p>
        <ToggleGroup
          label="Tambah atau kurangi"
          options={[
            ["1", "Tambah waktu"],
            ["-1", "Kurangi waktu"],
          ] as const}
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
        <input id={`adjust-sessions-${periodId}`} name="sessions" type="number" min={0} max={50} defaultValue={0} className={cn(inputClass, "w-28 tabular-nums")} />
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

const advanceTypes = { early_payment: "Gaji di muka", loan: "Pinjaman" } as const;

function installmentColor(installment: CashAdvance["installments"][number]): string {
  if (installment.status === "deducted") return "bg-success";
  if (installment.status === "settled") return "bg-info";
  return installment.skip_count > 0 ? "bg-warning" : "bg-secondary";
}

function Kasbon() {
  const { token } = useAuth();
  // "Semua" is "" for the API and "all" in the URL
  const [statusParam, setStatusParam] = useQueryState("kasbon", parseAsStringLiteral(["open", "paid", "all"] as const).withDefault("open"));
  const status = statusParam === "all" ? "" : statusParam;
  const setStatus = (next: typeof status) => void setStatusParam(next || "all");
  const advances = useApiData(`payroll-advances-${status}`, () => payrollApi.advances(token, status));
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<CashAdvance | null>(null);
  const list = advances.data?.advances;

  async function act(action: () => Promise<{ message: string }>) {
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    advances.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NativeSelect wrapperClassName="w-48" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Status kasbon">
          <option value="open">Masih dicicil</option>
          <option value="paid">Sudah lunas</option>
          <option value="">Semua</option>
        </NativeSelect>
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          Catat kasbon
        </Button>
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
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {advances.error && <ErrorState message={advances.error} onRetry={advances.reload} />}
      {!list && !advances.error && <CardsSkeleton count={2} />}

      {list?.length === 0 && (
        <div className="rounded-xl border border-dashed border-input bg-card/50">
          <EmptyState icon={HandCoins} title="Tidak ada kasbon" />
        </div>
      )}
      <ul className={cn("grid gap-3 xl:grid-cols-2", advances.loading && list && "opacity-60")}>
        {list?.map((advance) => {
          const paidCount = advance.installments.filter((installment) => installment.status !== "scheduled").length;
          const skipped = advance.installments.find((installment) => installment.status === "scheduled" && installment.skip_count > 0);

          return (
            <li key={advance.id} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs dark:shadow-none">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {advance.host.user.name}
                    <span className="font-semibold tabular-nums"> · {formatRupiah(advance.total_amount)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {advanceTypes[advance.type]} · {formatDate(advance.requested_at)}
                    {advance.brand ? ` · ${advance.brand.name}` : ""}
                    {advance.notes ? ` · ${advance.notes}` : ""}
                  </p>
                </div>
                {advance.status === "paid" ? (
                  <StatusBadge tone="success">Lunas</StatusBadge>
                ) : (
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {paidCount}/{advance.installment_count} cicilan
                    <span className="block text-sm font-semibold text-foreground">sisa {formatRupiah(advance.remaining_amount)}</span>
                  </span>
                )}
              </div>
              <div className="flex gap-1" aria-label={`${paidCount} dari ${advance.installment_count} cicilan terbayar`}>
                {advance.installments.map((installment) => (
                  <span
                    key={installment.id}
                    title={`${installment.seq}: ${formatRupiah(installment.amount)}${installment.skip_count > 0 ? ` · dilewati ${installment.skip_count}×` : ""}`}
                    className={cn("h-2 flex-1 rounded-full", installmentColor(installment))}
                  />
                ))}
              </div>
              {skipped && (
                <FormAlert tone="warning">
                  Cicilan {skipped.seq} ({formatRupiah(skipped.amount)}) dilewati di {skipped.skip_count} slip karena gaji tidak cukup. Pertimbangkan menjadwal ulang
                  jadi cicilan yang lebih kecil.
                </FormAlert>
              )}
              {advance.settled_at && (
                <p className="text-xs text-muted-foreground">
                  Dilunasi langsung pada {formatDate(advance.settled_at)}
                  {advance.settler ? ` (dicatat oleh ${advance.settler.name})` : ""}
                  {advance.settled_note ? ` · ${advance.settled_note}` : ""}
                </p>
              )}
              {(advance.status !== "paid" || paidCount === 0) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {advance.status !== "paid" && (
                    <>
                      <InlineAction
                        small
                        label="Dilunasi langsung"
                        placeholder="Catatan (opsional), mis. tunai tgl 3 Okt"
                        submitLabel="Tandai lunas"
                        onSubmit={(note) => act(() => payrollApi.settleAdvance(token, advance.id, note || null))}
                      />
                      <InlineAction
                        small
                        label="Jadwal ulang"
                        placeholder="Jumlah cicilan"
                        submitLabel="Bagi sisanya"
                        type="number"
                        required
                        onSubmit={(count) => act(() => payrollApi.rescheduleAdvance(token, advance.id, Number(count)))}
                      />
                    </>
                  )}
                  {paidCount === 0 && (
                    <Button type="button" variant="ghost" size="xs" onClick={() => setRemoving(advance)} className="ml-auto text-destructive hover:text-destructive">
                      Hapus (salah catat)
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {removing && (
        <ConfirmDialog
          title="Hapus kasbon ini?"
          confirmLabel="Hapus kasbon"
          cancelLabel="Kembali"
          onConfirm={() => act(() => payrollApi.removeAdvance(token, removing.id))}
          onClose={() => setRemoving(null)}
        >
          {advanceTypes[removing.type]} {removing.host.user.name} sebesar {formatRupiah(removing.total_amount)}. Belum ada cicilan yang dipotong.
        </ConfirmDialog>
      )}
    </div>
  );
}

function AdvanceForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const hosts = useApiData("payroll-hosts-all", () => payrollApi.hosts(token));
  const [chosenId, setChosenId] = useState("");
  // The select shows the first host until one is picked
  const hostId = chosenId || hosts.data?.hosts[0]?.host_id || "";
  const limit = useApiData(`payroll-advance-limit-${hostId}`, () => payrollApi.advanceLimit(token, hostId), { enabled: hostId !== "" });

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
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="advance-host">Host</Label>
          <NativeSelect id="advance-host" name="host_id" value={hostId} onChange={(event) => setChosenId(event.target.value)}>
            {hosts.data?.hosts.map((host) => (
              <option key={host.host_id} value={host.host_id}>
                {host.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advance-type">Jenis</Label>
          <NativeSelect id="advance-type" name="type">
            <option value="loan">Pinjaman</option>
            <option value="early_payment">Gaji di muka</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advance-amount">Jumlah</Label>
          <RupiahInput
            id="advance-amount"
            name="total_amount"
            placeholder="0"
            aria-invalid={errors.total_amount ? true : undefined}
            aria-describedby="advance-limit"
          />
          <FieldError>{errors.total_amount}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advance-installments">Jumlah cicilan</Label>
          <input id="advance-installments" name="installment_count" type="number" min={1} max={24} defaultValue={1} className={cn(inputClass, "tabular-nums")} />
          <FieldError>{errors.installment_count}</FieldError>
        </div>
        <p id="advance-limit" className={cn("text-xs text-muted-foreground sm:col-span-2", limit.loading && "opacity-60")}>
          {!limit.data
            ? "Kasbon berjalan tidak boleh melebihi gaji bulanan host menurut jadwalnya."
            : limit.data.limit.monthly_salary === 0
              ? "Host ini belum punya jadwal aktif atau tarif, jadi belum bisa kasbon."
              : `Bisa kasbon sampai ${formatRupiah(limit.data.limit.available)}: gaji bulanan dari jadwal ${formatRupiah(limit.data.limit.monthly_salary)}, kasbon berjalan ${formatRupiah(limit.data.limit.outstanding)}.`}
        </p>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="advance-notes">
            Catatan <span className="font-normal text-muted-foreground">(opsional)</span>
          </Label>
          <input id="advance-notes" name="notes" maxLength={255} className={inputClass} />
        </div>
        <FormActions loading={loading} submitLabel="Catat kasbon" onCancel={onCancel} />
      </form>
    </Modal>
  );
}
