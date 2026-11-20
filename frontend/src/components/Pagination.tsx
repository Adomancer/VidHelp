"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  lastPage: number;
  total?: number;
  /** "host", "pengguna", "brand"… */
  unit?: string;
  pageSize?: number;
  from?: number;
  to?: number;
  className?: string;
  onChange: (page: number) => void;
}

/** "1 … 4 5 6 … 12": every page up to 7, else first, last and neighbors around current. */
function pageList(page: number, last: number): (number | "…")[] {
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1);
  const shown = [...new Set([1, page - 1, page, page + 1, last])].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  return shown.flatMap((n, index) => (index > 0 && n - shown[index - 1] > 1 ? ["…" as const, n] : [n]));
}

/** Unified pagination bar: item range on the left, page numbers (desktop) + Prev/Next controls on the right. */
export default function Pagination({ page, lastPage, total, unit, pageSize, from, to, className, onChange }: PaginationProps) {
  if (lastPage <= 1) return null;

  const computedFrom = from ?? (total !== undefined && total > 0 && pageSize ? (page - 1) * pageSize + 1 : undefined);
  const computedTo = to ?? (total !== undefined && total > 0 && pageSize ? Math.min(page * pageSize, total) : undefined);

  const summary =
    computedFrom !== undefined && computedTo !== undefined && total !== undefined
      ? `Menampilkan ${computedFrom}–${computedTo} dari ${total}${unit ? ` ${unit}` : ""}`
      : `Halaman ${page} dari ${lastPage}${total !== undefined ? ` · ${total}${unit ? ` ${unit}` : ""}` : ""}`;

  return (
    <nav aria-label="Halaman" className={cn("flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground", className)}>
      <span className="tabular-nums">{summary}</span>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft aria-hidden="true" />
          Sebelumnya
        </Button>

        <div className="hidden items-center gap-1 sm:flex">
          {pageList(page, lastPage).map((item, index) =>
            item === "…" ? (
              <span key={`gap-${index}`} className="px-1.5 text-sm text-muted-foreground" aria-hidden="true">
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
                className="tabular-nums"
              >
                {item}
              </Button>
            )
          )}
        </div>

        <span className="px-1.5 text-xs font-medium text-muted-foreground tabular-nums sm:hidden">
          {page} / {lastPage}
        </span>

        <Button type="button" variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
          Berikutnya
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
