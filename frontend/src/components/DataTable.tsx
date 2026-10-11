"use client";

import { useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type SortDirection,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Numbers: header and cells to the right. */
    align?: "right";
    /** Extra classes for the column's header cell, e.g. "hidden sm:table-cell". */
    headClassName?: string;
    /** Extra classes for each of the column's cells. */
    cellClassName?: string;
  }
}

interface DataTableProps<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns mix value types
  columns: ColumnDef<T, any>[];
  data: T[];
  getRowId?: (row: T) => string;
  /** Sorted like this at first, e.g. [{ id: "amount", desc: true }]. */
  initialSorting?: SortingState;
  /** Phones get a list with one card per row (same order) and the table shows from `md` up. */
  renderMobile?: (row: T) => ReactNode;
  /** Per-row classes, e.g. hover or a selected row's background. */
  rowClassName?: (row: T) => string | undefined;
  /** Makes rows clickable and reachable with Tab (Enter or Space opens them too). */
  onRowClick?: (row: T) => void;
  /** Set when clicking a row opens a dialog, for screen readers. */
  rowOpensDialog?: boolean;
  className?: string;
  headerClassName?: string;
}

/**
 * A table of a whole list (not one page of it) that sorts in the browser: click a header
 * to sort by it, again to reverse. Columns are TanStack Table column definitions.
 */
export default function DataTable<T>({
  columns,
  data,
  getRowId,
  initialSorting = [],
  renderMobile,
  rowClassName,
  onRowClick,
  rowOpensDialog = false,
  className,
  headerClassName,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  // eslint-disable-next-line react-hooks/incompatible-library -- the table object is read fresh each render, nothing memoizes it
  const table = useReactTable<T>({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });
  const rows = table.getRowModel().rows;

  return (
    <>
      <Table containerClassName={cn(renderMobile && "hidden md:block")} className={className}>
        <TableHeader className={headerClassName}>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const { meta } = header.column.columnDef;
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={canSort ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}
                    className={cn(meta?.align === "right" && "text-right", meta?.headClassName)}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1 rounded px-1 font-medium outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                          sorted && "text-foreground",
                          meta?.align === "right" && "flex-row-reverse"
                        )}
                      >
                        {label}
                        <SortIcon sorted={sorted} />
                      </button>
                    ) : (
                      label
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(onRowClick && "cursor-pointer outline-none focus-visible:bg-muted/60", rowClassName?.(row.original))}
              {...(onRowClick && {
                tabIndex: 0,
                "aria-haspopup": rowOpensDialog ? ("dialog" as const) : undefined,
                onClick: () => onRowClick(row.original),
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onRowClick(row.original);
                },
              })}
            >
              {row.getVisibleCells().map((cell) => {
                const { meta } = cell.column.columnDef;
                return (
                  <TableCell key={cell.id} className={cn(meta?.align === "right" && "text-right tabular-nums", meta?.cellClassName)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {renderMobile && (
        <ul className="divide-y divide-border md:hidden">
          {rows.map((row) => (
            <li key={row.id}>{renderMobile(row.original)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function SortIcon({ sorted }: { sorted: false | SortDirection }) {
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return <Icon className={cn("size-3.5 shrink-0", !sorted && "opacity-50")} aria-hidden="true" />;
}
