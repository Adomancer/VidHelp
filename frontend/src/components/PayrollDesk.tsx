"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeCheck, CalendarRange, ChevronRight, Download, FileSpreadsheet, HandCoins, Hourglass, Landmark, Lock, Plus, Search, Send, Wallet } from "lucide-react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from "nuqs";
import { errorMessage, payrollApi, type CashAdvance, type HostPayRow, type PayrollOverview, type PeriodListItem } from "@/lib/api";
import { hasAnyRole } from "@/lib/auth";
import { compactHours, compactRupiah, formatDate, formatDuration, formatPeriodDates, formatRupiah } from "@/lib/format";
import { inputClass, inputSmClass } from "@/lib/ui";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
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
import FinanceReportDialog from "./FinanceReportDialog";
import FormAlert from "./FormAlert";
import { CardsSkeleton, RefreshBar, TableSkeleton } from "./Loading";
import Modal from "./Modal";
import Pagination from "./Pagination";
import PeriodBadge from "./PeriodBadge";
import RupiahInput from "./RupiahInput";
import SearchableSelect from "./SearchableSelect";
import { NativeSelect } from "./SelectField";
import StatCard from "./StatCard";
import StatusBadge from "./StatusBadge";
import SubmitButton from "./SubmitButton";
import { notify } from "./Toast";
import ToggleGroup, { ShortLabel } from "./ToggleGroup";

type Confirm = { title: string; body: string; label: string; destructive?: boolean; run: () => Promise<{ message: string }> } | null;

/** Only finance changes payroll and kasbon; admins see everything but can't change it. */
function useCanManageFinance(): boolean {
  const { user } = useAuth();
  return hasAnyRole(user, ["finance"]);
}

/**
 * Admin payroll: payment periods per brand (lock, pay, slips) and kasbon.
 * The tab, period filter, search, page, open period and kasbon filter live in the URL, so a refresh,
 * a shared link or coming back from a slip shows the same view.
 */
export default function PayrollDesk() {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(["periods", "kasbon"] as const).withDefault("periods"));
  const canManage = useCanManageFinance();
  const [reporting, setReporting] = useState(false);

  return (
    <div className="space-y-5">
      {!canManage && (
        <FormAlert tone="info">
          Mode lihat saja. Menutup periode, mengajukan pembayaran, menandai lunas, penyesuaian jam, dan kasbon hanya bisa dilakukan oleh akun Finance.
        </FormAlert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          label="Bagian penggajian"
          options={[
            ["periods", "Periode pembayaran"],
            ["kasbon", "Kasbon"],
          ] as const}
          value={tab}
          onChange={(next) => void setTab(next)}
        />
        <Button type="button" variant="outline" onClick={() => setReporting(true)}>
          <FileSpreadsheet aria-hidden="true" />
          Unduh laporan
        </Button>
      </div>
      {tab === "periods" ? <Periods /> : <Kasbon />}
      {reporting && <FinanceReportDialog onClose={() => setReporting(false)} />}
    </div>
  );
}

const periodTabs = [
  ["action", "Perlu tindakan"],
  ["in_progress", "Berjalan"],
  ["paid", "Lunas"],
  ["all", "Semua"],
] as const;

type PeriodTab = (typeof periodTabs)[number][0];

/** Phones can't fit the full labels on one row, and the tabs shouldn't scroll sideways. */
const shortPeriodTabs: Record<PeriodTab, string> = { action: "Perlu aksi", in_progress: "Berjalan", paid: "Lunas", all: "Semua" };

/** The filter, search and page live in the URL (with the open period), so a refresh or a shared link keeps the view. */
const periodUrlState = {
  status: parseAsStringLiteral(periodTabs.map(([value]) => value)).withDefault("action"),
  q: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
};

/** The server orders each list; said above it so nobody looks for a sort button. */
const orderNotes: Record<PeriodTab, string> = {
  action: "paling lama menunggu di atas",
  in_progress: "urut nama brand",
  paid: "terbaru di atas",
  all: "terbaru di atas",
};

const emptyTexts: Record<PeriodTab, { title: string; description: string }> = {
  action: {
    title: "Tidak ada yang perlu ditindaklanjuti",
    description: "Periode muncul di sini saat target jam brand tercapai, dan tetap di sini sampai brand membayar.",
  },
  in_progress: { title: "Tidak ada periode berjalan", description: "Periode dibuat otomatis setelah brand punya tanggal mulai penggajian." },
  paid: { title: "Belum ada periode yang lunas", description: "Periode pindah ke sini setelah ditandai lunas dan slip gajinya dibuat." },
  all: { title: "Belum ada periode pembayaran", description: "Periode dibuat otomatis setelah brand punya tanggal mulai penggajian." },
};

/** "hari ini", "1 hari", "12 hari" since a moment. */
function daysSince(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return days < 1 ? "hari ini" : `${days} hari`;
}

function Periods() {
  const { token } = useAuth();
  const [{ status, q: search, page }, setUrlState] = useQueryStates(periodUrlState);
  const [query, setQuery] = useState(search);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const filters = { status: status === "all" ? undefined : status, search, page };
  const periods = useApiData(`payroll-periods-${JSON.stringify(filters)}`, () => payrollApi.periods(token, filters), { keepPrevious: true });
  const overview = useApiData("payroll-summary", () => payrollApi.summary(token));
  const invalidate = useInvalidate();
  const [error, setError] = useState<string | null>(null);
  const list = periods.data?.data;

  const [selected, setSelected] = useQueryState("period");
  const select = (id: string | null) => void setSelected(id);
  const current = list?.find((period) => period.id === selected);

  useEffect(() => () => clearTimeout(debounce.current), []);

  function show(next: PeriodTab) {
    void setUrlState({ status: next, page: null });
  }

  function type(next: string) {
    setQuery(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void setUrlState({ q: next.trim(), page: null }), 300);
  }

  const empty = search ? { title: `Tidak ada brand yang cocok dengan "${search}"`, description: "Coba nama lain, atau lihat semua status." } : emptyTexts[status];

  return (
    <div className="space-y-4">
      <Overview overview={overview.data} status={status} onShow={show} />

      {overview.data && overview.data.brands_without_start.count > 0 && <WithoutStart brands={overview.data.brands_without_start} />}
      {error && <FormAlert tone="error">{error}</FormAlert>}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <ToggleGroup
          label="Status periode"
          options={periodTabs.map(([value, label]) => ({ value, label: <ShortLabel short={shortPeriodTabs[value]} full={label} /> }))}
          value={status}
          onChange={show}
          fill
        />
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => type(event.target.value)}
            placeholder="Cari brand…"
            aria-label="Cari brand"
            className={cn(inputClass, "pl-9")}
          />
        </div>
      </div>

      {periods.error && <ErrorState message={periods.error} onRetry={periods.reload} />}

      <div className="space-y-2">
        {periods.data && periods.data.total > 0 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {periods.data.total} periode · {orderNotes[status]}
          </p>
        )}
        <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
          <RefreshBar active={periods.loading && Boolean(list)} />
          {!list && !periods.error && <TableSkeleton rows={8} columns={4} />}
          {list?.length === 0 && <EmptyState icon={search ? Search : CalendarRange} title={empty.title} description={empty.description} />}

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
                  className={cn("w-full space-y-2.5 p-4 text-left outline-none focus-visible:bg-muted/60", period.id === selected ? "bg-primary/[0.06]" : "active:bg-muted/60")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{period.brand?.name}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatPeriodDates(period.period_start, period.period_end)} · {period.hosts} host
                      </p>
                    </div>
                    <PeriodStatusCell period={period} align="end" />
                  </div>
                  <div className="flex items-end justify-between gap-4">
                    <HoursProgress period={period} className="min-w-0 flex-1" />
                    <PayCell period={period} />
                  </div>
                </button>
              )}
            />
          )}
        </div>
      </div>

      {periods.data && (
        <Pagination
          page={periods.data.current_page}
          lastPage={periods.data.last_page}
          total={periods.data.total}
          unit="periode"
          onChange={(next) => void setUrlState({ page: next })}
        />
      )}

      {selected && (
        <Dialog
          placement="side"
          size="xl"
          onClose={() => select(null)}
          title={current ? `${current.brand?.name} · ${formatPeriodDates(current.period_start, current.period_end)}` : "Periode pembayaran"}
          description={current && <PeriodBadge status={current.status} />}
        >
          <PeriodDetail
            key={selected}
            periodId={selected}
            onChanged={(text, tone = "success") => {
              if (tone === "success") notify({ text });
              else setError(text);
              invalidate("payroll-periods-");
              invalidate("payroll-summary");
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

/** Money at each stage; a card opens the list that holds it. */
function Overview({ overview, status, onShow }: { overview?: PayrollOverview; status: PeriodTab; onShow: (next: PeriodTab) => void }) {
  if (!overview) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Memuat ringkasan">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
        ))}
      </div>
    );
  }

  const { waiting_payment: waiting, requested, in_progress: running, paid_this_month: paid } = overview;
  const count = (value: number) => (
    <>
      {value}
      <span className="text-sm font-medium text-faint"> periode</span>
    </>
  );

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        compact
        icon={Hourglass}
        tone={waiting.count > 0 ? "warning" : "neutral"}
        label="Menunggu PIC"
        value={count(waiting.count)}
        note={waiting.count > 0 ? <span title={formatRupiah(waiting.amount)}>{compactRupiah(waiting.amount)} · target tercapai</span> : "Tidak ada"}
        onClick={() => onShow("action")}
        selected={status === "action"}
      />
      <StatCard
        compact
        icon={Landmark}
        tone={requested.count > 0 ? "brand" : "neutral"}
        label="Menunggu brand"
        value={count(requested.count)}
        note={
          requested.count > 0 ? (
            <span title={formatRupiah(requested.amount)}>
              {compactRupiah(requested.amount)}
              {requested.oldest_requested_at && ` · terlama ${daysSince(requested.oldest_requested_at)}`}
            </span>
          ) : (
            "Tidak ada"
          )
        }
        onClick={() => onShow("action")}
        selected={status === "action"}
      />
      <StatCard
        compact
        icon={CalendarRange}
        tone="info"
        label="Berjalan"
        value={count(running.count)}
        note="Menuju target jam brand"
        onClick={() => onShow("in_progress")}
        selected={status === "in_progress"}
      />
      <StatCard
        compact
        icon={BadgeCheck}
        tone="success"
        label="Lunas bulan ini"
        value={count(paid.count)}
        note={paid.count > 0 ? <span title={formatRupiah(paid.amount)}>{compactRupiah(paid.amount)} gaji host</span> : "Belum ada"}
        onClick={() => onShow("paid")}
        selected={status === "paid"}
      />
    </div>
  );
}

/** Brands whose hours go nowhere yet: a count and a few names, not a wall of them. */
function WithoutStart({ brands }: { brands: PayrollOverview["brands_without_start"] }) {
  const more = brands.count - brands.names.length;

  return (
    <FormAlert tone="warning">
      {brands.count} brand aktif belum punya tanggal mulai penggajian, jadi jam live-nya belum masuk periode: {brands.names.join(", ")}
      {more > 0 && ` dan ${more} lainnya`}. <Link href="/admin/brands">Atur di halaman Brand</Link>
    </FormAlert>
  );
}

function PeriodStatusCell({ period, align = "start" }: { period: PeriodListItem; align?: "start" | "end" }) {
  return (
    <div className={cn("flex shrink-0 flex-col gap-1", align === "end" ? "items-end" : "items-start")}>
      <PeriodBadge status={period.status} />
      {period.waiting_since && <span className="text-[11px] text-muted-foreground tabular-nums">menunggu {daysSince(period.waiting_since)}</span>}
    </div>
  );
}

/** Billable hours against the target; a running period fills up toward it. */
function HoursProgress({ period, className }: { period: PeriodListItem; className?: string }) {
  const percent = period.target_hours > 0 ? Math.min(100, (period.achieved_hours / period.target_hours) * 100) : 0;

  return (
    <div className={cn("space-y-1", className)} title={`${formatDuration(period.achieved_hours)} dari ${period.target_hours} jam`}>
      <Progress value={percent} aria-label={`Jam ${period.brand?.name}`} className="h-1.5" indicatorClassName={percent >= 100 ? "bg-success" : undefined} />
      <p className="text-xs text-muted-foreground tabular-nums">
        {compactHours(period.achieved_hours)} / {period.target_hours}j · {Math.round(percent)}%
      </p>
    </div>
  );
}

function PayCell({ period }: { period: PeriodListItem }) {
  return (
    <div className="shrink-0 text-right">
      <p className="text-sm font-semibold whitespace-nowrap text-foreground tabular-nums">{formatRupiah(period.total_amount)}</p>
      {(period.status === "in_progress" || period.status === "waiting_payment") && <p className="text-[11px] text-muted-foreground">perkiraan</p>}
    </div>
  );
}

/** The server pages each list in a fixed order, so the columns don't sort (it would only sort one page). */
const periodColumns: ColumnDef<PeriodListItem>[] = [
  {
    id: "period",
    header: "Brand · periode",
    enableSorting: false,
    cell: ({ row: { original: period } }) => (
      <>
        <p className="font-medium text-foreground">{period.brand?.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatPeriodDates(period.period_start, period.period_end)} · {period.hosts} host
        </p>
      </>
    ),
  },
  { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <PeriodStatusCell period={row.original} /> },
  {
    id: "hours",
    header: "Jam ditagihkan",
    enableSorting: false,
    meta: { headClassName: "w-56", cellClassName: "w-56" },
    cell: ({ row }) => <HoursProgress period={row.original} />,
  },
  {
    id: "pay",
    header: "Gaji host",
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => <PayCell period={row.original} />,
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
        <input id={`adjust-sessions-${periodId}`} name="sessions" type="number" min={0} max={50} defaultValue={0} className={cn(inputClass, "w-28 tabular-nums")} />
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
  const advances = useApiData(`payroll-advances-${status}`, () => payrollApi.advances(token, status), { keepPrevious: true });
  const canManage = useCanManageFinance();
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
        {canManage && (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Catat kasbon
          </Button>
        )}
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
              {canManage && (advance.status !== "paid" || paidCount === 0) && (
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setRemoving(advance)}
                      className="ml-auto text-destructive hover:text-destructive max-md:h-10 max-md:px-3"
                    >
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
          {hosts.error && <ErrorState message={hosts.error} onRetry={hosts.reload} />}
          {/* Hundreds of hosts: type to find one; the hidden field sends the choice with the form */}
          <SearchableSelect
            id="advance-host"
            value={hostId}
            onChange={setChosenId}
            options={hosts.data?.hosts.map((host) => ({ value: host.host_id, label: host.name })) ?? []}
            placeholder="Pilih host…"
          />
          <input type="hidden" name="host_id" value={hostId} />
          <FieldError>{errors.host_id}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advance-type">Jenis</Label>
          <NativeSelect id="advance-type" name="type">
            <option value="loan">Pinjaman</option>
            <option value="early_payment">Gaji di muka</option>
          </NativeSelect>
          <FieldError>{errors.type}</FieldError>
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
          <FieldError>{errors.notes}</FieldError>
        </div>
        <FormActions loading={loading} submitLabel="Catat kasbon" onCancel={onCancel} />
      </form>
    </Modal>
  );
}
