"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Download, History, MousePointerClick, Search, Sparkles, Star, ThumbsUp, Users } from "lucide-react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { errorMessage, pointsApi, type RatingRow } from "@/lib/api";
import { formatDate, formatShortDate } from "@/lib/format";
import { inputClass, inputSmClass } from "@/lib/ui";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-mobile";
import { useAuth } from "@/components/AuthProvider";
import ConfirmDialog from "@/components/ConfirmDialog";
import { MonthPicker } from "@/components/DatePicker";
import Dialog from "@/components/Dialog";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import FormAlert from "@/components/FormAlert";
import { ListSkeleton, RefreshBar } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import { SpBadge } from "@/components/PointsMeter";
import { sourceLabels } from "@/components/PointsDesk";
import SearchableSelect from "@/components/SearchableSelect";
import StatusBadge from "@/components/StatusBadge";
import { notify } from "@/components/Toast";
import ToggleGroup from "@/components/ToggleGroup";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const views = ["todo", "violations", "rated", "all"] as const;
type View = (typeof views)[number];

const viewLabels: Record<View, string> = {
  todo: "Perlu dinilai",
  violations: "Ada pelanggaran",
  rated: "Sudah dinilai",
  all: "Semua",
};

const inView: Record<View, (row: RatingRow) => boolean> = {
  todo: (row) => !row.rating,
  violations: (row) => row.violations > 0,
  rated: (row) => Boolean(row.rating),
  all: () => true,
};

/** Said above the list, so nobody looks for a sort button. */
const orderNotes: Record<View, string> = {
  todo: "yang perlu dipertimbangkan di atas",
  violations: "belum dinilai di atas",
  rated: "urut nama",
  all: "belum dinilai di atas",
};

/** Not rated yet first, and among those the lowest suggestion (the ones to think about); then by name. */
function byUrgency(a: RatingRow, b: RatingRow): number {
  if (Boolean(a.rating) !== Boolean(b.rating)) return a.rating ? 1 : -1;
  if (!a.rating && a.suggested !== b.suggested) return a.suggested - b.suggested;
  return a.name.localeCompare(b.name, "id");
}

/** The view, brand, search, month and open host live in the URL, so a refresh or a link keeps the place. */
const urlState = {
  month: parseAsString.withDefault(thisMonth()),
  view: parseAsStringLiteral(views).withDefault("todo"),
  brand: parseAsString.withDefault(""),
  q: parseAsString.withDefault(""),
  host: parseAsString.withDefault(""),
};

/** From `lg` the open host shows beside the list; below it opens over the list. */
const SIDE_BY_SIDE = "(min-width: 1024px)";

const rating1 = (value: number) => value.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const monthName = (monthYear: string, month: "short" | "long" = "long") =>
  new Date(`${monthYear}-01T00:00`).toLocaleDateString("id-ID", month === "long" ? { month: "long", year: "numeric" } : { month: "short" });

type Scale = { min: number; max: number };
type Bulk = { withoutDeductions: boolean; count: number };

/**
 * Monthly ratings as a queue: hosts with nothing taken off get the top rating in one go, the rest
 * are rated one by one beside what the rating rests on (the month's violations, recent ratings).
 */
export default function AdminRatingsPage() {
  const { token } = useAuth();
  const [{ month: monthParam, view, brand, q: search, host: openId }, setUrlState] = useQueryStates(urlState);
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : thisMonth();
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [historyOf, setHistoryOf] = useState<RatingRow | null>(null);
  const sideBySide = useMediaQuery(SIDE_BY_SIDE);
  const invalidate = useInvalidate();
  const ratings = useApiData(`ratings-${month}`, () => pointsApi.ratings(token, month));

  const rows = ratings.data?.hosts;
  const scale = ratings.data?.scale ?? { min: 1, max: 5 };
  const brands = useMemo(() => {
    const all = new Map<string, string>();
    for (const row of rows ?? []) for (const item of row.brands) all.set(item.id, item.name);
    return [...all].map(([id, name]) => ({ value: id, label: name })).sort((a, b) => a.label.localeCompare(b.label, "id"));
  }, [rows]);
  const brandName = brands.find((item) => item.value === brand)?.label;

  // The brand narrows everything on the page (counts, bulk actions); the view and search narrow the list
  const scoped = useMemo(() => (rows ?? []).filter((row) => !brand || row.brands.some((item) => item.id === brand)), [rows, brand]);
  const counts = Object.fromEntries(views.map((value) => [value, scoped.filter(inView[value]).length])) as Record<View, number>;
  const rated = scoped.filter((row) => row.rating);
  const average = rated.length > 0 ? rated.reduce((sum, row) => sum + row.rating!.rating, 0) / rated.length : null;
  const unrated = scoped.filter((row) => !row.rating);
  const clean = unrated.filter((row) => row.suggested >= scale.max);
  const term = search.trim().toLowerCase();
  const list = useMemo(
    () =>
      scoped
        .filter((row) => inView[view](row) && (!term || row.name.toLowerCase().includes(term)))
        .sort(view === "rated" ? (a, b) => a.name.localeCompare(b.name, "id") : byUrgency),
    [scoped, view, term]
  );
  const open = list.find((row) => row.host_id === openId) ?? (sideBySide ? list[0] : undefined);

  // J / K step through the list (not while typing or in a dialog)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const key = event.key.toLowerCase();
      if ((key !== "j" && key !== "k") || list.length === 0) return;
      const index = open ? list.indexOf(open) : -1;
      const next = list[Math.min(list.length - 1, Math.max(0, index + (key === "j" ? 1 : -1)))];
      if (next) void setUrlState({ host: next.host_id });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, open, setUrlState]);

  async function exportExcel() {
    setExporting(true);
    try {
      await pointsApi.exportRatings(token, month);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  /** Save, then open the next host (in "Perlu dinilai" the saved one leaves the list). */
  async function save(row: RatingRow, rating: number, note: string | null): Promise<boolean> {
    const index = list.indexOf(row);
    const next = list[index + 1] ?? (view === "todo" ? list[index - 1] : undefined);
    setError(null);
    try {
      await pointsApi.rate(token, { host_id: row.host_id, month_year: month, rating, note });
      notify({ text: `Tersimpan ${row.name}: ${rating1(rating)}` });
      if (next) void setUrlState({ host: next.host_id });
      invalidate(`rating-review-${row.host_id}`);
      ratings.reload();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    }
  }

  async function applyBulk({ withoutDeductions }: Bulk) {
    setError(null);
    try {
      notify({ text: (await pointsApi.applySuggested(token, month, { brandId: brand || undefined, withoutDeductions })).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    ratings.reload();
  }

  const panel = open && (
    <HostPanel
      key={`${month}-${open.host_id}-${open.rating?.rating ?? "none"}-${open.rating?.note ?? ""}`}
      row={open}
      month={month}
      scale={scale}
      save={save}
      onHistory={() => setHistoryOf(open)}
      inDialog={!sideBySide}
    />
  );

  return (
    // On laptops the page fills the screen under the header (3.5rem, plus p-6 / 2xl:p-8 around it) and the panes scroll inside
    <div className="flex flex-col gap-4 lg:h-[calc(100svh-6.5rem)] lg:min-h-[36rem] 2xl:h-[calc(100svh-7.5rem)]">
      <PageHeader
        title="Rating"
        actions={
          <>
            <MonthPicker value={month} onChange={(next) => void setUrlState({ month: next, host: null })} aria-label="Bulan" />
            <Button type="button" variant="outline" onClick={exportExcel} disabled={exporting} title="Rating, riwayat poin, dan riwayat SP bulan ini">
              <Download aria-hidden="true" />
              {exporting ? "Mengekspor…" : "Ekspor Excel"}
            </Button>
          </>
        }
      />

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {ratings.error && <ErrorState message={ratings.error} onRetry={ratings.reload} />}

      {/* Where the month stands, and the one-click part of the job */}
      {rows && rows.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-xs md:flex-row md:items-center dark:shadow-none">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-body">
              <span className="font-semibold text-foreground tabular-nums">{rated.length}</span> dari {scoped.length} host
              {brandName ? ` ${brandName}` : ""} dinilai untuk {monthName(month)}
              {average !== null && (
                <span className="text-muted-foreground">
                  {" · "}rata-rata <Star className="inline size-3.5 -translate-y-px fill-warning text-warning" aria-hidden="true" />{" "}
                  <span className="font-medium text-foreground tabular-nums">{rating1(average)}</span>
                </span>
              )}
            </p>
            <Progress
              value={scoped.length > 0 ? (rated.length / scoped.length) * 100 : 0}
              aria-label="Host yang sudah dinilai"
              className="mt-2 h-1.5"
              indicatorClassName={unrated.length === 0 ? "bg-success" : undefined}
            />
          </div>
          {unrated.length === 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-success">
              <Check className="size-4" aria-hidden="true" />
              Semua sudah dinilai
            </span>
          ) : (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:flex-wrap">
              {clean.length > 0 && (
                <Button
                  type="button"
                  className="h-auto min-h-10 whitespace-normal md:min-h-9"
                  onClick={() => setBulk({ withoutDeductions: true, count: clean.length })}
                  title="Host tanpa potongan rating bulan ini"
                >
                  <ThumbsUp aria-hidden="true" />
                  Beri {rating1(scale.max)} ke {clean.length} host tanpa pelanggaran
                </Button>
              )}
              {unrated.length > clean.length && (
                <Button type="button" variant="outline" onClick={() => setBulk({ withoutDeductions: false, count: unrated.length })}>
                  <Sparkles aria-hidden="true" />
                  Pakai saran untuk semua ({unrated.length})
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <ToggleGroup
          label="Tampilkan"
          options={views.map((value) => ({
            value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {viewLabels[value]}
                {rows && <span className="text-xs text-muted-foreground tabular-nums">{counts[value]}</span>}
              </span>
            ),
          }))}
          value={view}
          onChange={(next) => void setUrlState({ view: next, host: null })}
          grid
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:ml-auto">
          <SearchableSelect
            value={brand || "all"}
            onChange={(next) => void setUrlState({ brand: next === "all" ? null : next, host: null })}
            options={[{ value: "all", label: "Semua brand" }, ...brands]}
            aria-label="Brand"
            className="sm:w-56"
          />
          <div className="relative sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => void setUrlState({ q: event.target.value || null, host: null })}
              placeholder="Cari host…"
              aria-label="Cari host"
              className={cn(inputClass, "pl-9")}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* The queue */}
        <section className="relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
          <RefreshBar active={ratings.loading && Boolean(rows)} />
          {list.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {list.length} host · {orderNotes[view]}
              </span>
              <span className="hidden items-center gap-1 lg:inline-flex" title="J: host berikutnya, K: sebelumnya">
                <Kbd>J</Kbd>
                <Kbd>K</Kbd> pindah
              </span>
            </div>
          )}

          {!rows && !ratings.error && <ListSkeleton rows={8} className="p-4" />}
          {rows?.length === 0 && <EmptyState icon={Users} title="Tidak ada host aktif" className="flex-1" />}
          {rows && rows.length > 0 && list.length === 0 && (
            <EmptyState
              icon={term ? Search : Check}
              title={term ? `Tidak ada host bernama "${search.trim()}"` : view === "todo" ? "Semua host sudah dinilai" : "Tidak ada host di sini"}
              description={term ? "Coba nama lain." : view === "todo" ? "Ganti ke Sudah dinilai untuk mengubah rating." : undefined}
              className="flex-1"
            />
          )}

          {list.length > 0 && (
            <ul aria-label="Daftar host" className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
              {list.map((row) => (
                <QueueRow
                  key={row.host_id}
                  row={row}
                  max={scale.max}
                  active={row.host_id === open?.host_id}
                  onOpen={() => void setUrlState({ host: row.host_id })}
                />
              ))}
            </ul>
          )}
        </section>

        {/* The open host, beside the list from lg */}
        {sideBySide && (
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
            {panel ?? <EmptyState icon={MousePointerClick} title="Pilih host" description="Penilaiannya muncul di sini." className="flex-1" />}
          </section>
        )}
      </div>

      {/* Below lg the host opens over the list */}
      {!sideBySide && open && openId && (
        <Dialog placement="side" size="lg" onClose={() => void setUrlState({ host: null })} title="Beri rating">
          {panel}
        </Dialog>
      )}

      {bulk && (
        <ConfirmDialog
          title={bulk.withoutDeductions ? `Beri ${rating1(scale.max)} ke ${bulk.count} host?` : `Pakai saran untuk ${bulk.count} host?`}
          confirmLabel={`Simpan ${bulk.count} rating`}
          destructive={false}
          onConfirm={() => applyBulk(bulk)}
          onClose={() => setBulk(null)}
        >
          {bulk.withoutDeductions
            ? `Host${brandName ? ` ${brandName}` : ""} yang belum dinilai untuk ${monthName(month)} dan tidak punya potongan rating dari pelanggaran diberi ${rating1(scale.max)}.`
            : `Semua host${brandName ? ` ${brandName}` : ""} yang belum dinilai untuk ${monthName(month)} diberi rating saran (5 dikurangi dampak pelanggaran bulan itu).`}{" "}
          Rating yang sudah diberikan tidak berubah, dan semuanya masih bisa diubah setelahnya.
        </ConfirmDialog>
      )}

      {historyOf && (
        <Dialog
          placement="side"
          size="lg"
          onClose={() => setHistoryOf(null)}
          title={`Riwayat ${historyOf.name}`}
          description="Poin dan SP di semua periode, terbaru di atas."
        >
          <HostHistory hostId={historyOf.host_id} />
        </Dialog>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px] font-medium text-body">{children}</kbd>;
}

function QueueRow({ row, max, active, onOpen }: { row: RatingRow; max: number; active: boolean; onOpen: () => void }) {
  // Keep the open one in sight when J / K or "next" moves past the edge
  const [node, setNode] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (active) node?.scrollIntoView({ block: "nearest" });
  }, [active, node]);

  return (
    <li>
      <button
        ref={setNode}
        type="button"
        onClick={onOpen}
        aria-current={active || undefined}
        className={cn(
          "flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors outline-none focus-visible:bg-muted/60",
          active ? "border-l-primary bg-primary/[0.06]" : "border-l-transparent hover:bg-muted/40"
        )}
      >
        <UserAvatar user={row} size="size-8 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.violations > 0 && <span className="font-medium text-destructive">{row.violations} pelanggaran · </span>}
            {row.brands.length > 0 ? row.brands.map((item) => item.name).join(", ") : "Tanpa brand aktif"}
          </p>
        </div>
        {row.rating ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-foreground tabular-nums">
            <Star className="size-3.5 fill-warning text-warning" aria-hidden="true" />
            {rating1(row.rating.rating)}
          </span>
        ) : (
          <span className={cn("shrink-0 text-xs tabular-nums", row.suggested < max ? "font-medium text-warning" : "text-muted-foreground")}>
            saran {rating1(row.suggested)}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * Rate one host: stars (or keys 1–5) and a decimal, a note, then "Simpan & lanjut". Beside it what
 * the rating rests on: the month's violations (how the suggestion came about) and recent months.
 */
function HostPanel({
  row,
  month,
  scale,
  save,
  onHistory,
  inDialog,
}: {
  row: RatingRow;
  month: string;
  scale: Scale;
  save: (row: RatingRow, rating: number, note: string | null) => Promise<boolean>;
  onHistory: () => void;
  /** In a dialog (phones): its body scrolls and frames the panel, and the save bar sticks to its bottom */
  inDialog: boolean;
}) {
  const { token } = useAuth();
  const review = useApiData(`rating-review-${row.host_id}-${month}`, () => pointsApi.ratingReview(token, row.host_id, month));
  const [rating, setRating] = useState(String(row.rating?.rating ?? row.suggested));
  const [note, setNote] = useState(row.rating?.note ?? "");
  const [busy, setBusy] = useState(false);
  const value = Number(rating);
  const valid = rating !== "" && value >= scale.min && value <= scale.max;
  const unchanged = Boolean(row.rating) && value === row.rating!.rating && note === (row.rating!.note ?? "");

  // Keys 1–5 set the stars (not while typing)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      const star = Number(event.key);
      if (Number.isInteger(star) && star >= scale.min && star <= scale.max) setRating(String(star));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scale.min, scale.max]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    await save(row, value, note.trim() || null);
    setBusy(false);
  }

  const deductions = review.data?.violations.reduce((sum, violation) => sum + violation.rating_impact, 0) ?? 0;

  return (
    <form onSubmit={submit} className={cn("flex flex-col", !inDialog && "min-h-0 flex-1")}>
      <div className={cn("space-y-6", !inDialog && "min-h-0 flex-1 overflow-y-auto p-5")}>
        <div className="flex items-start gap-3">
          <UserAvatar user={row} size="size-11 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-foreground">{row.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {row.brands.length > 0 ? row.brands.map((item) => item.name).join(", ") : "Tanpa brand aktif"}
            </p>
          </div>
          {row.rating ? (
            <StatusBadge tone="success" dot>
              Dinilai{row.rating.rater ? ` · ${row.rating.rater.name}` : ""}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" dot>
              Belum dinilai
            </StatusBadge>
          )}
        </div>

        {/* The rating */}
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground">Rating {monthName(month)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
            <StarPicker value={valid ? value : 0} max={scale.max} onPick={(star) => setRating(String(star))} />
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={scale.min}
                max={scale.max}
                step={0.1}
                value={rating}
                onChange={(event) => setRating(event.target.value)}
                aria-label="Rating"
                aria-invalid={!valid}
                className={cn(
                  inputSmClass,
                  "w-20 text-base font-semibold tabular-nums md:text-base",
                  !valid && "border-destructive focus-visible:ring-destructive/30"
                )}
              />
              {value !== row.suggested && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRating(String(row.suggested))} className="text-muted-foreground">
                  Pakai saran {rating1(row.suggested)}
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 hidden text-[11px] text-muted-foreground lg:block">
            Tekan <Kbd>1</Kbd>–<Kbd>{scale.max}</Kbd> untuk bintang, <Kbd>Enter</Kbd> untuk simpan.
          </p>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={255}
            placeholder="Catatan untuk host (opsional)"
            aria-label="Catatan"
            className={cn(inputSmClass, "mt-3")}
          />
        </div>

        {/* Why the suggestion is what it is */}
        <div>
          <h3 className="text-sm font-semibold text-foreground">Saran {rating1(row.suggested)}</h3>
          {!review.data && !review.error && <Skeleton className="mt-2 h-16 rounded-lg" />}
          {review.error && <FormAlert tone="error">{review.error}</FormAlert>}
          {review.data &&
            (review.data.violations.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Tidak ada pelanggaran di {monthName(month)}, jadi sarannya penuh.</p>
            ) : (
              <div className="mt-2 overflow-hidden rounded-lg border border-border">
                <ul className="divide-y divide-border">
                  {review.data.violations.map((violation) => (
                    <li key={violation.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="text-foreground">{violation.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatShortDate(violation.occurred_on)} · {violation.points} poin
                          {violation.reason && ` · ${violation.reason}`}
                        </p>
                      </div>
                      <span className="shrink-0 font-medium text-destructive tabular-nums">−{rating1(violation.rating_impact)}</span>
                    </li>
                  ))}
                </ul>
                <p className="flex justify-between gap-3 border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground tabular-nums">
                  <span>
                    {rating1(scale.max)} − {rating1(deductions)}
                  </span>
                  <span className="font-semibold text-foreground">= {rating1(row.suggested)}</span>
                </p>
              </div>
            ))}
        </div>

        {/* Recent months */}
        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Rating bulan-bulan terakhir</h3>
            <Button type="button" variant="ghost" size="sm" onClick={onHistory} className="-mr-2 text-muted-foreground">
              <History aria-hidden="true" />
              Poin & SP
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          {!review.data && !review.error && <Skeleton className="mt-2 h-20 rounded-lg" />}
          {review.data && <RecentRatings ratings={review.data.ratings} month={month} max={scale.max} />}
        </div>
      </div>

      <div
        className={cn(
          "flex items-center justify-end gap-2 border-t border-border px-5 py-3",
          inDialog ? "sticky bottom-0 -mx-5 mt-6 -mb-5 bg-card sm:-mx-6 sm:px-6" : "bg-muted/30"
        )}
      >
        {unchanged && <span className="mr-auto text-xs text-muted-foreground">Belum ada perubahan</span>}
        <Button type="submit" disabled={busy || !valid}>
          <Check aria-hidden="true" />
          {busy ? "Menyimpan…" : `Simpan ${valid ? rating1(value) : ""} & lanjut`}
        </Button>
      </div>
    </form>
  );
}

/** The last six months as small bars (the month being rated included once it has a rating). */
function RecentRatings({ ratings, month, max }: { ratings: { month_year: string; rating: number }[]; month: string; max: number }) {
  if (ratings.length === 0) return <p className="mt-1 text-sm text-muted-foreground">Belum ada rating sebelumnya.</p>;
  const shown = [...ratings].reverse();

  return (
    <div className="mt-2 flex items-end gap-2 sm:gap-3" role="list" aria-label="Rating per bulan">
      {shown.map((item) => (
        <div key={item.month_year} role="listitem" className="flex w-11 min-w-0 flex-initial flex-col items-center gap-1">
          <span className="text-xs font-medium text-foreground tabular-nums">{rating1(item.rating)}</span>
          <div className="flex h-14 w-8 items-end rounded-md bg-muted">
            <div
              className={cn("w-full rounded-md", item.month_year === month ? "bg-primary" : item.rating < 4 ? "bg-warning" : "bg-primary/40")}
              style={{ height: `${(item.rating / max) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">{monthName(item.month_year, "short")}</span>
        </div>
      ))}
    </div>
  );
}

/** Big stars for the open host: a click sets that whole rating; a half star shows a .5. */
function StarPicker({ value, max, onPick }: { value: number; max: number; onPick: (star: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;

  return (
    <div className="flex" role="group" aria-label="Bintang" onMouseLeave={() => setHover(null)}>
      {Array.from({ length: max }, (_, index) => index + 1).map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onPick(star)}
          onMouseEnter={() => setHover(star)}
          aria-label={`${star} bintang`}
          aria-pressed={value === star}
          className="rounded-md p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Star
            className={cn(
              "size-8 transition-colors",
              shown >= star ? "fill-warning text-warning" : shown >= star - 0.5 ? "fill-warning/40 text-warning" : "text-border"
            )}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

/** A host's point and SP history across every period, newest first. Cancelled entries are struck through. */
function HostHistory({ hostId }: { hostId: string }) {
  const { token } = useAuth();
  const history = useApiData(`rating-history-${hostId}`, () => pointsApi.history(token, hostId));

  if (history.error) return <FormAlert tone="error">{history.error}</FormAlert>;
  if (!history.data) return <ListSkeleton rows={4} />;
  const { logs, warning_letters: letters } = history.data;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Riwayat SP</h3>
        {letters.length === 0 && <p className="text-sm text-muted-foreground">Belum ada surat peringatan.</p>}
        <ul className="space-y-1.5">
          {letters.map((letter) => (
            <li key={letter.id} className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
              {letter.voided_at ? <span className="text-xs text-faint line-through">SP{letter.level}</span> : <SpBadge level={letter.level} />}
              <div className="min-w-0">
                <p className={cn("text-sm", letter.voided_at ? "text-faint line-through" : "text-foreground")}>{letter.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(letter.issued_at)} · {letter.issuer ? `oleh ${letter.issuer.name}` : "otomatis"}
                  {letter.voided_at ? " · dibatalkan" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Riwayat poin</h3>
        {logs.length === 0 && <p className="text-sm text-muted-foreground">Belum ada perubahan poin.</p>}
        <ul className="divide-y divide-border rounded-md border border-border">
          {logs.map((log) => (
            <li key={log.id} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className={cn("text-sm", log.voided_at ? "text-faint line-through" : "text-foreground")}>
                  {log.violation_type?.name ?? sourceLabels[log.source]}
                  {log.brand_complaint && <span className="text-muted-foreground"> · {log.brand_complaint.brand.name}</span>}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    log.voided_at ? "text-faint" : log.points_change < 0 ? "text-destructive" : "text-success"
                  )}
                >
                  {log.points_change > 0 ? "+" : ""}
                  {log.points_change}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatShortDate(log.occurred_on)}
                {log.recorder ? ` · oleh ${log.recorder.name}` : " · otomatis"}
                {log.voided_at ? " · dibatalkan" : ""}
                {log.reason ? ` · ${log.reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
