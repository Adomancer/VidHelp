"use client";

import type { ReactNode } from "react";
import { Rows3, Rows4 } from "lucide-react";
import SearchInput from "@/components/SearchInput";
import { cn } from "@/lib/utils";
import TableFilterDrawer from "./TableFilterDrawer";
import type { TableDensity } from "./useTableDensity";

interface DensityToggleProps {
  density: TableDensity;
  onChange: (next: TableDensity) => void;
  className?: string;
}

/** Segmented density control ("Nyaman" / "Ringkas") for data tables. */
export function DensityToggle({ density, onChange, className }: DensityToggleProps) {
  const options: { value: TableDensity; label: string; icon: typeof Rows3 }[] = [
    { value: "comfortable", label: "Nyaman", icon: Rows3 },
    { value: "compact", label: "Ringkas", icon: Rows4 },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Kepadatan baris"
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5", className)}
    >
      {options.map((option) => {
        const active = density === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface TableToolbarProps {
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    "aria-label"?: string;
  };
  tabs?: ReactNode;
  filters?: ReactNode;
  activeFilterCount?: number;
  onResetFilters?: () => void;
  density?: TableDensity;
  onDensityChange?: (next: TableDensity) => void;
  actions?: ReactNode;
  className?: string;
}

/**
 * Responsive toolbar above a DataTable:
 * - Desktop (`md+`): tabs, search, inline filters, density toggle, and actions.
 * - Mobile (`< md`): tabs, search, bottom-sheet filter drawer trigger, and actions.
 */
export default function TableToolbar({
  search,
  tabs,
  filters,
  activeFilterCount = 0,
  onResetFilters,
  density,
  onDensityChange,
  actions,
  className,
}: TableToolbarProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {tabs && <div className="flex flex-wrap items-center justify-between gap-3">{tabs}</div>}

      {(search || filters || onDensityChange || actions) && (
        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {search && (
              <SearchInput
                value={search.value}
                onChange={search.onChange}
                placeholder={search.placeholder ?? "Cari…"}
                aria-label={search["aria-label"] ?? search.placeholder ?? "Cari"}
                className="min-w-0 flex-1 md:max-w-xs"
              />
            )}
            {filters && <div className="hidden flex-wrap items-center gap-2 md:flex">{filters}</div>}
            {filters && (
              <div className="md:hidden">
                <TableFilterDrawer activeCount={activeFilterCount} onReset={onResetFilters}>
                  {filters}
                </TableFilterDrawer>
              </div>
            )}
          </div>

          {(onDensityChange || actions) && (
            <div className="flex flex-wrap items-center gap-2">
              {density && onDensityChange && <DensityToggle density={density} onChange={onDensityChange} className="hidden md:inline-flex" />}
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
