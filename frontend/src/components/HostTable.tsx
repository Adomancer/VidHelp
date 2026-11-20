"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ChevronRight, Copy, Crown, Download, Users } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { errorMessage, operatorApi, type HostListItem } from "@/lib/api";
import { formatTenure } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import AssignmentEditor from "./AssignmentEditor";
import { useAuth } from "./AuthProvider";
import Combobox from "./Combobox";
import DataTable from "./DataTable";
import EmptyState from "./EmptyState";
import FormAlert from "./FormAlert";
import HostSearch, { type SearchChip } from "./HostSearch";
import Pagination from "./Pagination";
import StatusBadge from "./StatusBadge";
import { notify } from "./Toast";
import UserAvatar from "./UserAvatar";
import { DensityToggle, TableFilterDrawer, useTableDensity, type BulkAction } from "./data-table";

interface HostTableProps {
  /** Admin: clicking a row (anywhere on it) opens the host. */
  onSelect?: (host: HostListItem) => void;
  /** Operator: expand a row to manage the host's brands in place. */
  editableBrands?: boolean;
}

/** Brand filter and page live in the URL, so a refresh or the Back button keeps them. */
const urlState = {
  brand: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
};

/**
 * Searchable, brand-filterable host list shared by the operator and admin panels.
 * After editing a host, `invalidate("hosts-")` loads the list again.
 */
export default function HostTable({ onSelect, editableBrands = false }: HostTableProps) {
  const { token } = useAuth();
  const invalidate = useInvalidate();
  const [chips, setChips] = useState<SearchChip[]>([]);
  const [{ brand: brandId, page }, setUrlState] = useQueryStates(urlState);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [density, setDensity] = useTableDensity();

  const filters = {
    search: chips.flatMap((chip) => (chip.kind === "text" ? [chip.text] : [])),
    host_ids: chips.flatMap((chip) => (chip.kind === "host" ? [chip.id] : [])),
    brand_id: brandId,
  };

  async function exportExcel() {
    setExporting(true);
    setExportError(null);
    try {
      await operatorApi.exportHosts(token, filters);
    } catch (caught) {
      setExportError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  const brands = useApiData("brands", () => operatorApi.brands(token));
  const hosts = useApiData(`hosts-${JSON.stringify({ filters, page })}`, () => operatorApi.hosts(token, { ...filters, page }), { keepPrevious: true });
  const list = hosts.data?.data;

  const brandOptions = (brands.data?.brands ?? []).map((brand) => ({ value: brand.id, label: brand.name }));

  const editor = (host: HostListItem) =>
    brands.data && (
      <AssignmentEditor
        hostId={host.id}
        assignments={host.assignments}
        brands={brands.data.brands}
        onChanged={() => {
          // The host's row and the brands' host counts and leaders
          void invalidate("hosts-");
          void invalidate("brands");
        }}
      />
    );

  const columns: ColumnDef<HostListItem>[] = [
    {
      id: "host",
      enableSorting: false,
      header: "Host",
      cell: ({ row }) => <HostCell host={row.original} />,
    },
    {
      id: "rate",
      enableSorting: false,
      header: "Level tarif",
      meta: { cellClassName: "whitespace-nowrap" },
      cell: ({ row }) => <RateCell host={row.original} />,
    },
    {
      id: "brands",
      enableSorting: false,
      header: "Brand",
      cell: ({ row }) => <BrandChips host={row.original} />,
    },
    {
      id: "status",
      enableSorting: false,
      header: "Status",
      cell: ({ row }) => <HostStatus status={row.original.status} />,
    },
    ...((editableBrands || onSelect
      ? [
          {
            id: "actions",
            enableSorting: false,
            header: () => <span className="sr-only">Aksi</span>,
            meta: { align: "right" as const, headClassName: "w-12" },
            cell: ({ row }: { row: { original: HostListItem } }) => {
              const host = row.original;
              const open = openId === host.id;
              if (editableBrands) {
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenId(open ? null : host.id);
                    }}
                    aria-expanded={open}
                  >
                    Brand
                    <ChevronDown className={cn("transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
                  </Button>
                );
              }
              return <ChevronRight className="ml-auto size-4 text-faint" aria-hidden="true" />;
            },
          },
        ]
      : []) satisfies ColumnDef<HostListItem>[]),
  ];

  const bulkActions: BulkAction<HostListItem>[] = [
    {
      id: "copy-hosts",
      label: "Salin daftar",
      icon: Copy,
      confirmTitle: (count) => `Salin ${count} host ke clipboard?`,
      confirmDescription: (count) => `Nama dan email dari ${count} host terpilih akan disalin ke clipboard.`,
      confirmLabel: "Salin",
      runBatch: async (items) => {
        await navigator.clipboard.writeText(items.map((host) => `${host.user.name} <${host.user.email}>`).join("\n"));
        notify({ text: `${items.length} host disalin` });
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <HostSearch
          value={chips}
          onChange={(next) => {
            setChips(next);
            void setUrlState({ page: null });
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden sm:block sm:w-52">
            <Combobox
              clearable
              options={brandOptions}
              value={brandId || null}
              onChange={(value) => void setUrlState({ brand: value ?? "", page: null })}
              placeholder="Semua brand"
              empty="Brand tidak ditemukan."
              aria-label="Filter brand"
            />
          </div>
          <div className="sm:hidden">
            <TableFilterDrawer title="Filter host" activeCount={brandId ? 1 : 0} onReset={() => void setUrlState({ brand: "", page: null })}>
              <div className="space-y-1.5">
                <Label htmlFor="mobile-host-brand">Brand</Label>
                <Combobox
                  id="mobile-host-brand"
                  clearable
                  options={brandOptions}
                  value={brandId || null}
                  onChange={(value) => void setUrlState({ brand: value ?? "", page: null })}
                  placeholder="Semua brand"
                  empty="Brand tidak ditemukan."
                />
              </div>
            </TableFilterDrawer>
          </div>
          <DensityToggle density={density} onChange={setDensity} className="hidden md:inline-flex" />
          <Button type="button" variant="outline" onClick={exportExcel} disabled={exporting} title="Semua host yang cocok dengan pencarian dan filter brand">
            <Download aria-hidden="true" />
            <span className="hidden sm:inline">{exporting ? "Mengekspor…" : "Ekspor Excel"}</span>
            <span className="sm:hidden">{exporting ? "…" : "Ekspor"}</span>
          </Button>
        </div>
      </div>

      {exportError && <FormAlert tone="error">{exportError}</FormAlert>}

      <DataTable<HostListItem>
        framed
        columns={columns}
        data={list ?? []}
        getRowId={(host) => host.id}
        density={density}
        stickyHeader
        stickyFirstColumn
        loading={!list && !hosts.error}
        reloading={hosts.loading && Boolean(list)}
        error={hosts.error}
        onRetry={hosts.reload}
        enableRowSelection
        bulkActions={bulkActions}
        onRowClick={onSelect}
        rowOpensDialog={Boolean(onSelect)}
        renderExpanded={editableBrands ? (host) => editor(host) : undefined}
        isRowExpanded={editableBrands ? (host) => openId === host.id : undefined}
        rowClassName={(host) => cn("text-body", openId === host.id && "bg-muted/40")}
        empty={
          <EmptyState
            icon={Users}
            title="Tidak ada host"
            description="Host muncul di sini setelah admin menyetujui akunnya. Coba ubah pencarian atau filter brand."
          />
        }
        renderMobile={(host, { selected, toggleSelected }) => {
          const open = openId === host.id;
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <HostCell host={host} />
                <HostStatus status={host.status} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <RateCell host={host} />
                <BrandChips host={host} />
              </div>
            </>
          );

          return onSelect ? (
            <div className="flex items-start gap-3 p-4">
              <Checkbox checked={selected} onCheckedChange={toggleSelected} aria-label={`Pilih ${host.user.name}`} className="mt-1 shrink-0" />
              <button
                type="button"
                onClick={() => onSelect(host)}
                className="min-w-0 flex-1 space-y-3 text-left transition-colors duration-150 outline-none focus-visible:bg-muted/60 active:bg-muted/60"
              >
                {body}
              </button>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <Checkbox checked={selected} onCheckedChange={toggleSelected} aria-label={`Pilih ${host.user.name}`} className="mt-1 shrink-0" />
                <div className="min-w-0 flex-1 space-y-3">{body}</div>
              </div>
              {editableBrands && (
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setOpenId(open ? null : host.id)} aria-expanded={open}>
                  Atur brand
                  <ChevronDown className={cn("transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
                </Button>
              )}
              {open && editor(host)}
            </div>
          );
        }}
      />

      {hosts.data && (
        <Pagination
          page={hosts.data.current_page}
          lastPage={hosts.data.last_page}
          total={hosts.data.total}
          pageSize={hosts.data.per_page}
          unit="host"
          onChange={(next) => void setUrlState({ page: next })}
        />
      )}
    </div>
  );
}

function HostCell({ host }: { host: HostListItem }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <UserAvatar user={host.user} size="size-9 text-sm" />
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{host.user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{host.user.email}</p>
      </div>
    </div>
  );
}

function RateCell({ host }: { host: HostListItem }) {
  return (
    <div>
      <p className="text-sm text-foreground">{host.rate_category?.name ?? "–"}</p>
      <p className="text-xs text-muted-foreground">
        {formatTenure(host.join_date)}
        {host.rate_category_overridden && " · diatur admin"}
      </p>
    </div>
  );
}

function BrandChips({ host }: { host: HostListItem }) {
  const active = host.assignments.filter((assignment) => assignment.status === "active");
  if (active.length === 0) return <span className="text-xs text-faint">Belum ada brand</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {active.map((assignment) => (
        <span
          key={assignment.id}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-secondary px-2 text-xs font-medium whitespace-nowrap text-body"
        >
          <span className="truncate">{assignment.brand.name}</span>
          {assignment.is_leader && <Crown className="size-3 text-warning" aria-label="Leader" />}
        </span>
      ))}
    </div>
  );
}

function HostStatus({ status }: { status: string }) {
  return (
    <StatusBadge tone={status === "active" ? "success" : status === "banned" ? "danger" : "neutral"} dot>
      {statusLabel(status)}
    </StatusBadge>
  );
}
