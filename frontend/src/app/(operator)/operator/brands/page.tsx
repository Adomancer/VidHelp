"use client";

import { useState } from "react";
import { BookOpen, Tag } from "lucide-react";
import { operatorApi, type BrandSummary } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import { KnowledgeEditor } from "@/components/BrandKnowledge";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { RefreshBar, TableSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";

/** Product knowledge of every brand: paste what the brand sends on WA, upload their PDFs and files. */
export default function OperatorBrandsPage() {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const [editing, setEditing] = useState<BrandSummary | null>(null);
  const list = brands.data?.brands;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Knowledge"
        description="Teks dan file product knowledge tiap brand, apa pun bentuk kirimannya (teks WA, PDF, screenshot, dokumen). Host membacanya sebelum live."
      />

      {brands.error && <ErrorState message={brands.error} onRetry={brands.reload} />}

      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <RefreshBar active={brands.loading && Boolean(list)} />
        {!list && !brands.error && <TableSkeleton rows={4} columns={2} />}
        {list?.length === 0 && <EmptyState icon={Tag} title="Belum ada brand" description="Admin menambahkan brand di halaman Brand." />}

        {list && list.length > 0 && (
          <ul className="divide-y divide-border">
            {list.map((brand) => (
              <li key={brand.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-brand"
                    aria-hidden="true"
                  >
                    {brand.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{brand.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{brand.active_hosts_count} host aktif</p>
                  </div>
                  {brand.status !== "active" && <StatusBadge tone="neutral">Nonaktif</StatusBadge>}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(brand)}>
                  <BookOpen aria-hidden="true" />
                  Kelola
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && <KnowledgeEditor brand={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
