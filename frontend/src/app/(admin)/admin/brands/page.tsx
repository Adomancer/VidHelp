"use client";

import { useEffect, useState } from "react";
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Copy, Crown, Pencil, Plus, Search, Tag, X } from "lucide-react";
import { adminHostsApi, errorMessage, fieldErrors, operatorApi, scheduleApi, type BrandInput, type BrandSummary } from "@/lib/api";
import { formatDate, toDateInput } from "@/lib/format";
import { htmlToText, richTextClass } from "@/lib/richText";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { KnowledgeEditor } from "@/components/BrandKnowledge";
import DatePicker from "@/components/DatePicker";
import Dialog from "@/components/Dialog";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { FieldError, FieldHint } from "@/components/FieldMessage";
import { CardsSkeleton, RefreshBar } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import SelectField, { NativeSelect } from "@/components/SelectField";
import StatusBadge from "@/components/StatusBadge";
import { notifyCapsule } from "@/components/Toast";
import { useAuth } from "@/components/AuthProvider";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const PAGE_SIZE = 10;
const TOAST_MS = 2200;
const DEFAULT_TARGET = 720;

const statuses = ["semua", "aktif", "nonaktif"] as const;
const conditions = ["tanpa-leader", "belum-gajian", "obs"] as const;
const sorts = ["nama", "terbaru", "host", "target"] as const;
type Condition = (typeof conditions)[number];
type Sort = (typeof sorts)[number];

const conditionLabels: Record<Condition, string> = {
  "tanpa-leader": "Belum ada leader",
  "belum-gajian": "Penggajian belum dimulai",
  obs: "Brand OBS",
};
const statusLabels: Record<(typeof statuses)[number], string> = { semua: "Semua", aktif: "Aktif", nonaktif: "Nonaktif" };
const sortLabels: Record<Sort, string> = { nama: "Nama A–Z", terbaru: "Terbaru", host: "Host terbanyak", target: "Target tertinggi" };

const includes = (text: string | null | undefined, query: string) => Boolean(text && query && text.toLowerCase().includes(query.toLowerCase()));

/** Why a brand matches the search: in its name or leader, or only in its product knowledge. */
function searchMatch(brand: BrandSummary, query: string): "none" | "direct" | "knowledge" {
  if (!query) return "direct";
  if (includes(brand.name, query) || includes(brand.leader?.name, query)) return "direct";
  return includes(brand.product_knowledge && htmlToText(brand.product_knowledge), query) ? "knowledge" : "none";
}

function sortBrands(brands: BrandSummary[], sort: Sort): BrandSummary[] {
  const byName = (a: BrandSummary, b: BrandSummary) => a.name.localeCompare(b.name, "id", { sensitivity: "base" });
  return [...brands].sort((a, b) => {
    if (sort === "terbaru") return (b.created_at ?? "").localeCompare(a.created_at ?? "") || byName(a, b);
    if (sort === "host") return b.active_hosts_count - a.active_hosts_count || byName(a, b);
    if (sort === "target") return b.target_hours_per_period - a.target_hours_per_period || byName(a, b);
    return byName(a, b);
  });
}

/** "1 … 4 5 6 … 12": every page up to 7, else the first, the last and the ones around the current. */
function pageList(page: number, last: number): (number | "…")[] {
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);
  const shown = [...new Set([1, page - 1, page, page + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  return shown.flatMap((n, index) => (index > 0 && n - shown[index - 1] > 1 ? ["…" as const, n] : [n]));
}

/**
 * Admin: brands as cards. Search (name, leader, product knowledge), filter by status and
 * condition, sort, 10 per page; a card opens the details in a side panel, the pencil the form,
 * the book the product knowledge editor.
 */
export default function AdminBrandsPage() {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const [query, setQuery] = useQueryState("q");
  const [status, setStatus] = useQueryState("status", parseAsStringLiteral(statuses).withDefault("semua"));
  const [condition, setCondition] = useQueryState("kondisi", parseAsStringLiteral(conditions));
  const [sort, setSort] = useQueryState("urut", parseAsStringLiteral(sorts).withDefault("nama"));
  const [pageParam, setPage] = useQueryState("hal", parseAsInteger.withDefault(1));
  const [input, setInput] = useState(query ?? "");
  const [detailId, setDetailId] = useState<string | null>(null);
  /** The open form; `fromDetail` brings the details back after it closes. */
  const [form, setForm] = useState<{ brand: BrandSummary | null; fromDetail: boolean } | null>(null);
  /** The open product knowledge editor; `fromDetail` as for the form. */
  const [knowledge, setKnowledge] = useState<{ brand: BrandSummary; fromDetail: boolean } | null>(null);

  // Search 150 ms after the last keystroke, back on page 1
  useEffect(() => {
    const next = input.trim();
    if (next === (query ?? "")) return;
    const timer = setTimeout(() => {
      void setQuery(next || null);
      void setPage(null);
    }, 150);
    return () => clearTimeout(timer);
  }, [input, query, setQuery, setPage]);

  const all = brands.data?.brands ?? [];
  const q = query ?? "";
  const counts = {
    semua: all.length,
    aktif: all.filter((brand) => brand.status === "active").length,
    nonaktif: all.filter((brand) => brand.status === "inactive").length,
  };
  const results = sortBrands(
    all.filter(
      (brand) =>
        (status === "semua" || brand.status === (status === "aktif" ? "active" : "inactive")) &&
        (condition !== "tanpa-leader" || !brand.leader) &&
        (condition !== "belum-gajian" || !brand.payroll_start_date) &&
        (condition !== "obs" || brand.is_obs) &&
        searchMatch(brand, q) !== "none"
    ),
    sort
  );
  const lastPage = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, pageParam), lastPage);
  const shown = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const detail = all.find((brand) => brand.id === detailId) ?? null;

  function goTo(next: number) {
    void setPage(next === 1 ? null : next);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col gap-6">
      <PageHeader
        title={<span className="text-[30px] leading-tight">Brand</span>}
        description="Target jam, siklus pembayaran dan product knowledge tiap brand. Host ditugaskan ke brand di halaman Host."
        actions={
          <Button type="button" size="lg" onClick={() => setForm({ brand: null, fromDetail: false })}>
            <Plus aria-hidden="true" />
            Brand baru
          </Button>
        }
      />

      {/* Toolbar: search, status, condition, sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-[1_1_20rem]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={input}
            onChange={(change) => setInput(change.target.value)}
            placeholder="Cari nama brand, leader, atau isi product knowledge…"
            aria-label="Cari brand"
            className={cn(inputClass, "h-11 pr-10 pl-9 md:h-11 [&::-webkit-search-cancel-button]:hidden")}
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              aria-label="Hapus pencarian"
              className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors outline-none hover:bg-muted-foreground/20 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:right-2.5 md:size-6"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div role="radiogroup" aria-label="Status brand" className="inline-flex h-11 items-center gap-1 rounded-lg border border-border bg-card p-1">
          {statuses.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={status === item}
              onClick={() => {
                void setStatus(item === "semua" ? null : item);
                void setPage(null);
              }}
              className={cn(
                "flex h-full items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                status === item ? "bg-primary/10 text-brand" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {statusLabels[item]}
              <span className="text-xs tabular-nums opacity-80">{counts[item]}</span>
            </button>
          ))}
        </div>

        <NativeSelect
          aria-label="Kondisi brand"
          value={condition ?? ""}
          onChange={(change) => {
            void setCondition((change.target.value || null) as Condition | null);
            void setPage(null);
          }}
          wrapperClassName="w-full sm:w-56"
          className="h-11 md:h-11"
        >
          <option value="">Semua kondisi</option>
          {conditions.map((item) => (
            <option key={item} value={item}>
              {conditionLabels[item]}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Urutkan"
          value={sort}
          onChange={(change) => {
            void setSort(change.target.value === "nama" ? null : (change.target.value as Sort));
            void setPage(null);
          }}
          wrapperClassName="w-full sm:w-48"
          className="h-11 md:h-11"
        >
          {sorts.map((item) => (
            <option key={item} value={item}>
              {sortLabels[item]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {brands.error && <ErrorState message={brands.error} onRetry={brands.reload} />}
      {!brands.data && !brands.error && <CardsSkeleton count={4} />}

      {brands.data && (
        <div className="relative">
          <RefreshBar active={brands.loading} />
          {all.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border">
              <EmptyState
                icon={Tag}
                title="Belum ada brand"
                description="Tambahkan brand pertama untuk mulai menyusun jadwal dan penggajian."
                action={
                  <Button type="button" onClick={() => setForm({ brand: null, fromDetail: false })}>
                    <Plus aria-hidden="true" />
                    Brand baru
                  </Button>
                }
              />
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-border px-6 py-14 text-center">
              <p className="text-sm font-medium text-foreground">Tidak ada brand ditemukan.</p>
              <p className="mt-1 text-sm text-muted-foreground">Coba ubah kata kunci atau filter pencarian.</p>
            </div>
          ) : (
            <ul className="grid auto-rows-[250px] grid-cols-1 gap-4 min-[900px]:grid-cols-2 min-[1500px]:grid-cols-5">
              {shown.map((brand) => (
                <li key={brand.id} className="min-w-0">
                  <BrandCard
                    brand={brand}
                    query={q}
                    onOpen={() => setDetailId(brand.id)}
                    onEdit={() => setForm({ brand, fromDetail: false })}
                    onKnowledge={() => setKnowledge({ brand, fromDetail: false })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {results.length > 0 && <Pager page={page} lastPage={lastPage} total={results.length} onChange={goTo} />}

      {detail && !form && !knowledge && (
        <BrandDrawer
          brand={detail}
          query={q}
          onClose={() => setDetailId(null)}
          onEdit={() => setForm({ brand: detail, fromDetail: true })}
          onKnowledge={() => setKnowledge({ brand: detail, fromDetail: true })}
        />
      )}

      {knowledge && (
        <KnowledgeEditor
          brand={knowledge.brand}
          onClose={() => {
            if (!knowledge.fromDetail) setDetailId(null);
            setKnowledge(null);
            // The text may have changed: the cards' search and the details read it
            brands.reload();
          }}
        />
      )}

      {form && (
        <BrandForm
          key={form.brand?.id ?? "new"}
          brand={form.brand}
          onSaved={() => {
            if (!form.fromDetail) setDetailId(null);
            setForm(null);
            brands.reload();
          }}
          onClose={() => {
            if (!form.fromDetail) setDetailId(null);
            setForm(null);
          }}
        />
      )}
    </div>
  );
}

/** Marks every occurrence of `query` in `text`. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-warning/30 px-0.5 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

function BrandAvatar({ brand, size }: { brand: BrandSummary; size: "card" | "drawer" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-semibold",
        size === "card" ? "size-[46px] text-lg" : "size-[52px] text-xl",
        brand.status === "active" ? "bg-primary/10 text-brand" : "bg-muted text-muted-foreground"
      )}
    >
      {brand.name.charAt(0).toUpperCase()}
    </span>
  );
}

function BrandPills({ brand }: { brand: BrandSummary }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge tone={brand.status === "active" ? "success" : "neutral"} dot={brand.status === "active"} className="h-5 px-1.5 text-[11px]">
        {brand.status === "active" ? "Aktif" : "Nonaktif"}
      </StatusBadge>
      {brand.is_obs && (
        <StatusBadge tone="info" className="h-5 px-1.5 text-[11px]">
          OBS
        </StatusBadge>
      )}
    </span>
  );
}

function BrandCard({
  brand,
  query,
  onOpen,
  onEdit,
  onKnowledge,
}: {
  brand: BrandSummary;
  query: string;
  onOpen: () => void;
  onEdit: () => void;
  onKnowledge: () => void;
}) {
  const inactive = brand.status === "inactive";
  const knowledgeOnly = searchMatch(brand, query) === "knowledge";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${brand.name}, ${inactive ? "nonaktif" : "aktif"}. Lihat detail`}
      onClick={onOpen}
      onKeyDown={(key) => {
        if (key.target !== key.currentTarget) return;
        if (key.key === "Enter" || key.key === " ") {
          key.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex h-full cursor-pointer flex-col gap-3 rounded-2xl border border-border p-4 shadow-xs transition duration-200 outline-none hover:border-foreground/20 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:hover:-translate-y-0.5 dark:shadow-none",
        inactive ? "bg-muted/40" : "bg-card"
      )}
    >
      <div className="flex items-start gap-3">
        <BrandAvatar brand={brand} size="card" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-semibold text-foreground" title={brand.name}>
            <Highlight text={brand.name} query={query} />
          </p>
          <BrandPills brand={brand} />
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="max-md:size-10"
            onClick={(click) => {
              click.stopPropagation();
              onKnowledge();
            }}
            onKeyDown={(key) => key.stopPropagation()}
            aria-label={`Product knowledge ${brand.name}`}
            title="Product knowledge"
          >
            <BookOpen />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="max-md:size-10"
            onClick={(click) => {
              click.stopPropagation();
              onEdit();
            }}
            onKeyDown={(key) => key.stopPropagation()}
            aria-label={`Edit ${brand.name}`}
            title="Edit brand"
          >
            <Pencil />
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Target / periode</dt>
          <dd className="truncate font-semibold text-foreground tabular-nums">{brand.target_hours_per_period.toLocaleString("id-ID")} jam</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Host aktif</dt>
          <dd className="truncate font-semibold text-foreground tabular-nums">{brand.active_hosts_count} orang</dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-xs text-muted-foreground">Leader</dt>
          <dd className={cn("flex min-w-0 items-center gap-1.5 font-medium", brand.leader ? "text-foreground" : "text-muted-foreground")}>
            <Crown className={cn("size-3.5 shrink-0", brand.leader ? "text-warning" : "text-faint")} aria-hidden="true" />
            <span className="truncate">{brand.leader ? <Highlight text={brand.leader.name} query={query} /> : "Belum ada leader"}</span>
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors group-hover:text-brand">
          Lihat detail
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </span>
        {knowledgeOnly && (
          <StatusBadge tone="warning" className="h-5 truncate px-1.5 text-[11px]">
            Cocok di product knowledge
          </StatusBadge>
        )}
      </div>
    </div>
  );
}

/** "Berjalan hari ke-5", "Mulai 3 hari lagi" or "Belum dimulai". */
function payrollState(start: string | null | undefined): string {
  if (!start) return "Belum dimulai";
  const day = 86_400_000;
  const diff = Math.round((new Date(`${start.slice(0, 10)}T00:00`).getTime() - new Date(`${toDateInput()}T00:00`).getTime()) / day);
  return diff > 0 ? `Mulai ${diff} hari lagi` : `Berjalan hari ke-${1 - diff}`;
}

function BrandDrawer({
  brand,
  query,
  onClose,
  onEdit,
  onKnowledge,
}: {
  brand: BrandSummary;
  query: string;
  onClose: () => void;
  onEdit: () => void;
  onKnowledge: () => void;
}) {
  const days = Math.round((brand.target_hours_per_period / 24) * 10) / 10;

  async function copy() {
    try {
      await navigator.clipboard.writeText(htmlToText(brand.product_knowledge ?? ""));
      notifyCapsule("Product knowledge disalin", "success", TOAST_MS);
    } catch {
      notifyCapsule("Gagal menyalin, coba lagi", "error", TOAST_MS);
    }
  }

  return (
    <Dialog
      placement="side"
      size="md"
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <BrandAvatar brand={brand} size="drawer" />
          <span className="min-w-0 space-y-1">
            <span className="block truncate text-lg">{brand.name}</span>
            <BrandPills brand={brand} />
          </span>
        </span>
      }
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Tutup
          </Button>
          <Button type="button" size="lg" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Edit brand
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Ringkasan</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Target / periode</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{brand.target_hours_per_period.toLocaleString("id-ID")} jam</p>
              <p className="text-xs text-muted-foreground tabular-nums">≈ {days.toLocaleString("id-ID")} hari</p>
            </div>
            <div className="rounded-xl border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Host aktif</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{brand.active_hosts_count} orang</p>
              <p className="text-xs text-muted-foreground">{brand.active_hosts_count > 0 ? "ditugaskan di halaman Host" : "belum ada host"}</p>
            </div>
            <div className="col-span-2 rounded-xl border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Mulai penggajian</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{brand.payroll_start_date ? formatDate(brand.payroll_start_date) : "—"}</p>
              <p className="text-xs text-muted-foreground">{payrollState(brand.payroll_start_date)}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Leader</h3>
          <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                brand.leader ? "bg-warning/12 text-warning" : "bg-muted text-faint"
              )}
            >
              <Crown className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate font-medium", brand.leader ? "text-foreground" : "text-muted-foreground")}>
                {brand.leader ? <Highlight text={brand.leader.name} query={query} /> : "Belum ada leader"}
              </span>
              <span className="block text-xs text-muted-foreground">{brand.leader ? "Penanggung jawab brand" : "Tunjuk leader dari halaman Host"}</span>
            </span>
          </div>
        </section>

        <BrandHosts brand={brand} />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Informasi</h3>
          <dl className="divide-y divide-border rounded-xl border border-border text-sm">
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium text-foreground">{brand.status === "active" ? "Aktif" : "Nonaktif"}</dd>
            </div>
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-muted-foreground">Brand OBS</dt>
              <dd className="font-medium text-foreground">{brand.is_obs ? "Ya" : "Tidak"}</dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Product knowledge</h3>
            <div className="flex gap-2">
              {brand.product_knowledge && (
                <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                  <Copy aria-hidden="true" />
                  Salin
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={onKnowledge}>
                <BookOpen aria-hidden="true" />
                Kelola
              </Button>
            </div>
          </div>
          {brand.product_knowledge ? (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              {/* Safe HTML: the API keeps only formatting tags */}
              <div className={richTextClass} dangerouslySetInnerHTML={{ __html: brand.product_knowledge }} />
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground italic">
              Belum ada product knowledge. Tambahkan lewat &ldquo;Kelola&rdquo; supaya host bisa membacanya.
            </p>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/** The hosts on the brand, folded away until opened (and only then loaded). */
function BrandHosts({ brand }: { brand: BrandSummary }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const hosts = useApiData(`brand-hosts-${brand.id}`, () => scheduleApi.brandHosts(token, brand.id), { enabled: open });
  const list = [...(hosts.data?.assignments ?? [])]
    .filter((assignment) => assignment.status === "active")
    .sort((a, b) => Number(b.is_leader) - Number(a.is_leader) || a.host.user.name.localeCompare(b.host.user.name, "id"));
  const count = brand.active_hosts_count;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Host terdaftar</h3>
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Belum ada host di brand ini. Tugaskan host dari halaman Host.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={`brand-hosts-${brand.id}`}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
          >
            <span>
              {count} host aktif
              <span className="ml-1.5 font-normal text-muted-foreground">{open ? "· sembunyikan" : "· lihat daftar"}</span>
            </span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
          </button>
          {open && (
            <div id={`brand-hosts-${brand.id}`} className="border-t border-border">
              {hosts.error ? (
                <p className="px-4 py-3 text-sm text-destructive">{hosts.error}</p>
              ) : !hosts.data ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Memuat host…</p>
              ) : (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                  {list.map((assignment) => (
                    <li key={assignment.id} className="flex items-center gap-3 px-4 py-2.5">
                      <UserAvatar user={assignment.host.user} size="size-8 text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{assignment.host.user.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{assignment.host.user.email}</span>
                      </span>
                      {assignment.is_leader && (
                        <StatusBadge tone="warning" className="h-5 shrink-0 gap-1 px-1.5 text-[11px]">
                          <Crown className="size-3" aria-hidden="true" />
                          Leader
                        </StatusBadge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Checks before sending; an empty target becomes 720. */
function check(data: FormData): { errors: Record<string, string>; target: number } {
  const errors: Record<string, string> = {};
  const name = formValue(data, "name").trim();
  const raw = formValue(data, "target_hours_per_period").trim();
  const target = raw === "" ? DEFAULT_TARGET : Number(raw);

  if (!name) errors.name = "Nama brand wajib diisi.";
  else if (name.length > 80) errors.name = "Nama brand maksimal 80 karakter.";
  if (!Number.isInteger(target) || target <= 0) errors.target_hours_per_period = "Target harus angka bulat lebih dari 0.";
  else if (target > 10000) errors.target_hours_per_period = "Target maksimal 10.000 jam.";

  return { errors, target };
}

function BrandForm({ brand, onSaved, onClose }: { brand: BrandSummary | null; onSaved: () => void; onClose: () => void }) {
  const { token } = useAuth();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const { errors: found, target } = check(data);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: BrandInput = {
      name: formValue(data, "name").trim(),
      is_obs: data.get("is_obs") === "on",
      target_hours_per_period: target,
      payroll_start_date: formValue(data, "payroll_start_date") || null,
      status: (formValue(data, "status") || "active") as BrandInput["status"],
    };

    setSaving(true);
    try {
      await (brand ? adminHostsApi.updateBrand(token, brand.id, input) : adminHostsApi.createBrand(token, input));
      notifyCapsule(brand ? "Brand diperbarui" : "Brand ditambahkan", "success", TOAST_MS);
      onSaved();
    } catch (caught) {
      const fields = fieldErrors(caught);
      setErrors(fields);
      // The server's reason (permission, conflict, offline…) unless the marked fields already say it
      notifyCapsule(Object.keys(fields).length > 0 ? "Periksa isian yang ditandai" : errorMessage(caught), "error", TOAST_MS);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={brand ? "Edit brand" : "Brand baru"}
      size="lg"
      onClose={onClose}
      dirty={dirty && !saving}
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="brand-form" size="lg" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </>
      }
    >
      <form id="brand-form" onSubmit={submit} onChange={() => setDirty(true)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="name">
            Nama <span className="text-destructive">*</span>
          </Label>
          <input
            id="name"
            name="name"
            defaultValue={brand?.name}
            maxLength={80}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "name-error" : undefined}
            className={inputClass}
          />
          <FieldError id="name-error">{errors.name}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="target_hours_per_period">Target jam per periode</Label>
          <input
            id="target_hours_per_period"
            name="target_hours_per_period"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            placeholder={String(DEFAULT_TARGET)}
            defaultValue={brand?.target_hours_per_period}
            aria-invalid={errors.target_hours_per_period ? true : undefined}
            className={cn(inputClass, "tabular-nums")}
          />
          {errors.target_hours_per_period ? (
            <FieldError>{errors.target_hours_per_period}</FieldError>
          ) : (
            <FieldHint>720 jam ≈ 1 bulan. Dikosongkan = 720.</FieldHint>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payroll_start_date">Mulai penggajian</Label>
          <DatePicker
            id="payroll_start_date"
            name="payroll_start_date"
            defaultValue={brand?.payroll_start_date?.slice(0, 10)}
            onChange={() => setDirty(true)}
            clearable
            placeholder="Belum dimulai"
            aria-invalid={errors.payroll_start_date ? true : undefined}
          />
          {errors.payroll_start_date ? <FieldError>{errors.payroll_start_date}</FieldError> : <FieldHint>Opsional. Awal periode pertama.</FieldHint>}
        </div>
        {brand && (
          <SelectField
            label="Status"
            name="status"
            defaultValue={brand.status}
            options={[
              { value: "active", label: "Aktif" },
              { value: "inactive", label: "Nonaktif" },
            ]}
          />
        )}
        <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm text-body transition-colors hover:bg-muted/40 has-checked:border-primary/50 has-checked:bg-primary/5 sm:col-span-2">
          <input type="checkbox" name="is_obs" defaultChecked={brand?.is_obs} className="size-4 accent-primary" />
          <span>
            <span className="block font-medium text-foreground">Brand OBS</span>
            <span className="block text-xs text-muted-foreground">Live brand ini memakai OBS.</span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}

function Pager({ page, lastPage, total, onChange }: { page: number; lastPage: number; total: number; onChange: (page: number) => void }) {
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <nav aria-label="Halaman brand" className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-sm text-muted-foreground tabular-nums">
        Menampilkan {from}–{to} dari {total} brand
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft aria-hidden="true" />
          Sebelumnya
        </Button>
        {pageList(page, lastPage).map((item, index) =>
          item === "…" ? (
            <span key={`gap-${index}`} className="px-1 text-sm text-muted-foreground" aria-hidden="true">
              …
            </span>
          ) : (
            <Button
              key={item}
              type="button"
              variant={item === page ? "default" : "outline"}
              size="icon-sm"
              aria-current={item === page ? "page" : undefined}
              aria-label={`Halaman ${item}`}
              onClick={() => onChange(item)}
              className="tabular-nums max-md:size-10"
            >
              {item}
            </Button>
          )
        )}
        <Button type="button" variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
          Berikutnya
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
