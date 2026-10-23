"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { BadgeCheck, CalendarRange, ChevronRight, Hourglass, Landmark, Search } from "lucide-react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState, useQueryStates } from "nuqs";
import { payrollApi, type PayrollOverview, type PeriodListItem } from "@/lib/api";
import { compactHours, compactRupiah, formatDuration, formatPeriodDates, formatRupiah } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "../AuthProvider";
import DataTable from "../DataTable";
import Dialog from "../Dialog";
import EmptyState from "../EmptyState";
import ErrorState from "../ErrorState";
import FormAlert from "../FormAlert";
import { RefreshBar, TableSkeleton } from "../Loading";
import Pagination from "../Pagination";
import PeriodBadge from "../PeriodBadge";
import StatCard from "../StatCard";
import { notify } from "../Toast";
import ToggleGroup, { ShortLabel } from "../ToggleGroup";
import { PeriodDetail } from "./PeriodDetail";
import { daysSince } from "./shared";

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

export function Periods() {
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
