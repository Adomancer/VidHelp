"use client";

import { useEffect, useState } from "react";
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { Plus, Search, Tag } from "lucide-react";
import { operatorApi, type BrandSummary } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { KnowledgeEditor } from "@/components/BrandKnowledge";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { CardsSkeleton, RefreshBar } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import Pagination from "@/components/Pagination";
import SearchInput from "@/components/SearchInput";
import { NativeSelect } from "@/components/SelectField";
import ToggleGroup from "@/components/ToggleGroup";
import { useAuth } from "@/components/AuthProvider";
import { TableFilterDrawer } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BrandCard } from "./_components/BrandCard";
import { BrandDrawer } from "./_components/BrandDrawer";
import { BrandForm } from "./_components/BrandForm";
import { searchMatch } from "./_components/shared";

const PAGE_SIZE = 10;

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

  const activeFilterCount = (condition ? 1 : 0) + (sort !== "nama" ? 1 : 0);

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col gap-6">
      <PageHeader
        title="Brand"
        description="Target jam, siklus pembayaran dan product knowledge tiap brand. Host ditugaskan ke brand di halaman Host."
        actions={
          <Button type="button" onClick={() => setForm({ brand: null, fromDetail: false })}>
            <Plus aria-hidden="true" />
            Brand baru
          </Button>
        }
      />

      {/* Toolbar: search, status, condition, sort */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={input}
          onChange={setInput}
          placeholder="Cari nama brand, leader, atau isi product knowledge…"
          aria-label="Cari brand"
          className="min-w-0 flex-[1_1_18rem]"
        />

        <ToggleGroup
          label="Status brand"
          value={status}
          onChange={(item) => {
            void setStatus(item === "semua" ? null : item);
            void setPage(null);
          }}
          options={statuses.map((item) => ({
            value: item,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <span>{statusLabels[item]}</span>
                <span className="text-xs tabular-nums opacity-80">{counts[item]}</span>
              </span>
            ),
          }))}
        />

        <div className="hidden md:flex md:items-center md:gap-2">
          <NativeSelect
            aria-label="Kondisi brand"
            value={condition ?? ""}
            onChange={(change) => {
              void setCondition((change.target.value || null) as Condition | null);
              void setPage(null);
            }}
            wrapperClassName="w-56"
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
            wrapperClassName="w-48"
          >
            {sorts.map((item) => (
              <option key={item} value={item}>
                {sortLabels[item]}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="md:hidden">
          <TableFilterDrawer
            title="Filter & urutkan brand"
            activeCount={activeFilterCount}
            onReset={() => {
              void setCondition(null);
              void setSort(null);
              void setPage(null);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="mobile-brand-condition">Kondisi</Label>
              <NativeSelect
                id="mobile-brand-condition"
                value={condition ?? ""}
                onChange={(change) => {
                  void setCondition((change.target.value || null) as Condition | null);
                  void setPage(null);
                }}
              >
                <option value="">Semua kondisi</option>
                {conditions.map((item) => (
                  <option key={item} value={item}>
                    {conditionLabels[item]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile-brand-sort">Urutkan</Label>
              <NativeSelect
                id="mobile-brand-sort"
                value={sort}
                onChange={(change) => {
                  void setSort(change.target.value === "nama" ? null : (change.target.value as Sort));
                  void setPage(null);
                }}
              >
                {sorts.map((item) => (
                  <option key={item} value={item}>
                    {sortLabels[item]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </TableFilterDrawer>
        </div>
      </div>

      {brands.error && <ErrorState message={brands.error} onRetry={brands.reload} />}
      {!brands.data && !brands.error && <CardsSkeleton count={4} />}

      {brands.data && (
        <div className="relative">
          <RefreshBar active={brands.loading} />
          {all.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50">
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
            <div className="rounded-xl border border-dashed border-border bg-card/50">
              <EmptyState icon={Search} title="Tidak ada brand ditemukan" description="Coba ubah kata kunci atau filter pencarian." />
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

      {results.length > 0 && <Pagination page={page} lastPage={lastPage} total={results.length} unit="brand" pageSize={PAGE_SIZE} onChange={goTo} />}

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
