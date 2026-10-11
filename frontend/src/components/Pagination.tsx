"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  lastPage: number;
  total?: number;
  /** "host", "pengguna"… */
  unit?: string;
  onChange: (page: number) => void;
}

/** "Halaman 2 dari 5 · 87 host" with previous / next; renders nothing when everything fits on one page. */
export default function Pagination({ page, lastPage, total, unit, onChange }: PaginationProps) {
  if (lastPage <= 1) return null;

  return (
    <nav aria-label="Halaman" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        Halaman {page} dari {lastPage}
        {total !== undefined && ` · ${total}${unit ? ` ${unit}` : ""}`}
      </span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft aria-hidden="true" />
          Sebelumnya
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
          Berikutnya
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
