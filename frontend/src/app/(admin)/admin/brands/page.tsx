"use client";

import { useEffect, useState } from "react";
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { Plus, Search, Tag, X } from "lucide-react";
import { operatorApi, type BrandSummary } from "@/lib/api";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { KnowledgeEditor } from "@/components/BrandKnowledge";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { CardsSkeleton, RefreshBar } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import { NativeSelect } from "@/components/SelectField";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { BrandCard } from "./_components/BrandCard";
import { BrandDrawer } from "./_components/BrandDrawer";
import { BrandForm } from "./_components/BrandForm";
import { PAGE_SIZE, Pager } from "./_components/Pager";
import { searchMatch } from "./_components/shared";

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

function sortBrands(brands: BrandSummary[], sort: Sort): BrandSummary[] {
  const byName = (a: BrandSummary, b: BrandSummary) => a.name.localeCompare(b.name, "id", { sensitivity: "base" });
  return [...brands].sort((a, b) => {
    if (sort === "terbaru") return (b.created_at ?? "").localeCompare(a.created_at ?? "") || byName(a, b);
    if (sort === "host") return b.active_hosts_count - a.active_hosts_count || byName(a, b);
    if (sort === "target") return b.target_hours_per_period - a.target_hours_per_period || byName(a, b);
    return byName(a, b);
  });
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
