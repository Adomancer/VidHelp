"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type RowSelectionState,
  type SortDirection,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import ErrorState from "./ErrorState";
import { RefreshBar, TableSkeleton } from "./Loading";
import TableBulkBar, { type BulkAction } from "./data-table/TableBulkBar";
import type { TableDensity } from "./data-table/useTableDensity";

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

const SELECT_COL_ID = "__select__";

interface DataTableProps<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns mix value types
  columns: ColumnDef<T, any>[];
  data: T[];
  getRowId?: (row: T) => string;
  /** Sorted like this at first, e.g. [{ id: "amount", desc: true }]. */
  initialSorting?: SortingState;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean;
  density?: TableDensity;
  stickyHeader?: boolean;
  stickyFirstColumn?: boolean;
  maxHeightClassName?: string;
  loading?: boolean;
  reloading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: ReactNode;
  enableRowSelection?: boolean;
  canSelectRow?: (row: T) => boolean;
  bulkActions?: BulkAction<T>[];
  onBulkDone?: () => void;
  renderExpanded?: (row: T) => ReactNode;
  isRowExpanded?: (row: T) => boolean;
  /** Phones get a list with one card per row (same order) and the table shows from `md` up. */
  renderMobile?: (row: T, context: { selected: boolean; toggleSelected: () => void; selectable: boolean }) => ReactNode;
  /** Per-row classes, e.g. hover or a selected row's background. */
  rowClassName?: (row: T) => string | undefined;
  /** Makes rows clickable and reachable with Tab (Enter or Space opens them too). */
  onRowClick?: (row: T) => void;
  /** Set when clicking a row opens a dialog, for screen readers. */
  rowOpensDialog?: boolean;
  /** Wraps loading skeleton, empty state, and table container in a card frame with thin border + shadow-card. */
  framed?: boolean;
  className?: string;
  headerClassName?: string;
}

/**
 * Shared TanStack Table with sticky header, sticky first column, density modes,
 * loading/empty/error states, optional row selection + bulk bar, and mobile card rendering.
 */
export default function DataTable<T>({
  columns,
  data,
  getRowId,
  initialSorting = [],
  sorting: controlledSorting,
  onSortingChange,
  manualSorting = false,
  density = "comfortable",
  stickyHeader = true,
  stickyFirstColumn = true,
  maxHeightClassName = "max-h-[min(72dvh,46rem)]",
  loading = false,
  reloading = false,
  error = null,
  onRetry,
  empty,
  enableRowSelection = false,
  canSelectRow,
  bulkActions,
  onBulkDone,
  renderExpanded,
  isRowExpanded,
  renderMobile,
  rowClassName,
  onRowClick,
  rowOpensDialog = false,
  framed = false,
  className,
  headerClassName,
}: DataTableProps<T>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>(initialSorting);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const sorting = controlledSorting ?? internalSorting;
  const handleSortingChange = onSortingChange ?? setInternalSorting;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns mix value types
  const tableColumns: ColumnDef<T, any>[] = enableRowSelection
    ? [
        {
          id: SELECT_COL_ID,
          enableSorting: false,
          header: ({ table }) => (
            <Checkbox
              checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
              onCheckedChange={(checked) => table.toggleAllPageRowsSelected(Boolean(checked))}
              aria-label="Pilih semua baris"
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              checked={row.getIsSelected()}
              disabled={!row.getCanSelect()}
              onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
              onClick={(event) => event.stopPropagation()}
              aria-label="Pilih baris"
            />
          ),
        },
        ...columns,
      ]
    : columns;

  // eslint-disable-next-line react-hooks/incompatible-library -- the table object is read fresh each render, nothing memoizes it
  const table = useReactTable<T>({
    data,
    columns: tableColumns,
    state: { sorting, rowSelection },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: setRowSelection,
    manualSorting,
    enableRowSelection: enableRowSelection ? (row) => (canSelectRow ? canSelectRow(row.original) : true) : false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getRowId,
  });

  const frameClass = "overflow-hidden rounded-xl border border-border bg-card shadow-card";

  if (loading && data.length === 0) {
    const skeleton = <TableSkeleton rows={6} columns={Math.max(columns.length, 4)} density={density} mobileCards={Boolean(renderMobile)} />;
    return framed ? <div className={frameClass}>{skeleton}</div> : skeleton;
  }

  if (error && data.length === 0) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  if (!loading && !error && data.length === 0 && empty) {
    return framed ? <div className={frameClass}>{empty}</div> : <>{empty}</>;
  }

  const rows = table.getRowModel().rows;
  const firstDataColId = columns.length > 0 ? table.getAllLeafColumns().find((col) => col.id !== SELECT_COL_ID)?.id : undefined;
  const selectedItems = enableRowSelection ? table.getSelectedRowModel().flatRows.map((row) => row.original) : [];
  const headPadding = density === "compact" ? "px-3 py-2" : "px-4 py-3";
  const cellPadding = density === "compact" ? "px-3 py-1.5 text-[13px]" : "px-4 py-3";
  const stickyFirstLeft = enableRowSelection ? "left-11" : "left-0";
  const visibleCount = table.getVisibleLeafColumns().length;

  return (
    <div className="space-y-3">
      {error && <ErrorState message={error} onRetry={onRetry} />}

      {enableRowSelection && bulkActions && bulkActions.length > 0 && (
        <TableBulkBar selectedItems={selectedItems} actions={bulkActions} onClear={() => table.resetRowSelection()} onComplete={onBulkDone} />
      )}

      <div className={cn("relative", framed && frameClass)}>
        <RefreshBar active={reloading} />

        <Table
          containerClassName={cn(renderMobile && "hidden md:block", stickyHeader && maxHeightClassName && `overflow-y-auto ${maxHeightClassName}`)}
          className={className}
        >
          <TableHeader className={headerClassName}>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const { meta } = header.column.columnDef;
                  const isSelectCol = header.column.id === SELECT_COL_ID;
                  const isFirstDataCol = stickyFirstColumn && header.column.id === firstDataColId;
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());

                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={canSort ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}
                      className={cn(
                        headPadding,
                        meta?.align === "right" && "text-right",
                        isSelectCol && cn("sticky left-0 w-11 min-w-11 bg-muted px-3", stickyHeader ? "top-0 z-30" : "z-20"),
                        isFirstDataCol && cn("sticky bg-muted shadow-[inset_-1px_0_0_var(--border)]", stickyFirstLeft, stickyHeader ? "top-0 z-20" : "z-10"),
                        !isSelectCol && !isFirstDataCol && stickyHeader && "sticky top-0 z-10 bg-muted",
                        meta?.headClassName
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "-mx-1 inline-flex items-center gap-1 rounded px-1 font-semibold transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
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
            {rows.map((row) => {
              const expanded = Boolean(renderExpanded && isRowExpanded?.(row.original));
              return (
                <Fragment key={row.id}>
                  <TableRow
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className={cn(onRowClick && "cursor-pointer outline-none hover:bg-muted/60 focus-visible:bg-muted/60", rowClassName?.(row.original))}
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
                      const isSelectCol = cell.column.id === SELECT_COL_ID;
                      const isFirstDataCol = stickyFirstColumn && cell.column.id === firstDataColId;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            cellPadding,
                            meta?.align === "right" && "text-right tabular-nums",
                            isSelectCol &&
                              "sticky left-0 z-10 w-11 min-w-11 bg-card px-3 group-hover/row:bg-muted group-data-[state=selected]/row:bg-secondary",
                            isFirstDataCol &&
                              cn(
                                "sticky z-10 bg-card shadow-[inset_-1px_0_0_var(--border)] group-hover/row:bg-muted group-data-[state=selected]/row:bg-secondary",
                                stickyFirstLeft
                              ),
                            meta?.cellClassName
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                  {expanded && (
                    <TableRow>
                      <TableCell colSpan={visibleCount} className="bg-muted/30 p-4">
                        {renderExpanded?.(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>

        {renderMobile && (
          <ul className="divide-y divide-border md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                {renderMobile(row.original, {
                  selected: row.getIsSelected(),
                  toggleSelected: () => row.toggleSelected(),
                  selectable: row.getCanSelect(),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SortIcon({ sorted }: { sorted: false | SortDirection }) {
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return <Icon className={cn("size-3.5 shrink-0", !sorted && "opacity-50")} aria-hidden="true" />;
}
