"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Crown, Download, Users } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { errorMessage, operatorApi, type HostListItem } from "@/lib/api";
import { formatTenure } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import AssignmentEditor from "./AssignmentEditor";
import { useAuth } from "./AuthProvider";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import FormAlert from "./FormAlert";
import HostSearch, { type SearchChip } from "./HostSearch";
import { RefreshBar, TableSkeleton } from "./Loading";
import Pagination from "./Pagination";
import { NativeSelect } from "./SelectField";
import StatusBadge from "./StatusBadge";
import UserAvatar from "./UserAvatar";

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
        <div className="flex gap-2">
          <NativeSelect
            wrapperClassName="flex-1 sm:w-52 sm:flex-none"
            value={brandId}
            onChange={(event) => void setUrlState({ brand: event.target.value, page: null })}
            aria-label="Filter brand"
          >
            <option value="">Semua brand</option>
            {brands.data?.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </NativeSelect>
          <Button type="button" variant="outline" onClick={exportExcel} disabled={exporting} title="Semua host yang cocok dengan pencarian dan filter brand">
            <Download aria-hidden="true" />
            <span className="hidden sm:inline">{exporting ? "Mengekspor…" : "Ekspor Excel"}</span>
            <span className="sm:hidden">{exporting ? "…" : "Ekspor"}</span>
          </Button>
        </div>
      </div>

      {exportError && <FormAlert tone="error">{exportError}</FormAlert>}
      {hosts.error && <ErrorState message={hosts.error} onRetry={hosts.reload} />}

      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <RefreshBar active={hosts.loading && Boolean(list)} />
        {!list && !hosts.error && <TableSkeleton rows={6} columns={4} />}

        {list?.length === 0 && (
          <EmptyState icon={Users} title="Tidak ada host" description="Host muncul di sini setelah admin menyetujui akunnya. Coba ubah pencarian atau filter brand." />
        )}

        {list && list.length > 0 && (
          <>
            <Table containerClassName="hidden md:block">
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Level tarif</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Status</TableHead>
                  {(editableBrands || onSelect) && (
                    <TableHead className="w-12">
                      <span className="sr-only">Aksi</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((host) => {
                  const open = openId === host.id;
                  return (
                    <Fragment key={host.id}>
                      <TableRow
                        className={cn(
                          "text-body",
                          onSelect && "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:outline-none",
                          open && "bg-muted/40"
                        )}
                        {...(onSelect && {
                          tabIndex: 0,
                          title: `Buka ${host.user.name}`,
                          onClick: () => onSelect(host),
                          onKeyDown: (event: React.KeyboardEvent) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelect(host);
                            }
                          },
                        })}
                      >
                        <TableCell>
                          <HostCell host={host} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <RateCell host={host} />
                        </TableCell>
                        <TableCell>
                          <BrandChips host={host} />
                        </TableCell>
                        <TableCell>
                          <HostStatus status={host.status} />
                        </TableCell>
                        {editableBrands && (
                          <TableCell className="text-right">
                            <Button type="button" variant="outline" size="sm" onClick={() => setOpenId(open ? null : host.id)} aria-expanded={open}>
                              Brand
                              <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
                            </Button>
                          </TableCell>
                        )}
                        {onSelect && !editableBrands && (
                          <TableCell className="text-right">
                            <ChevronRight className="ml-auto size-4 text-faint" aria-hidden="true" />
                          </TableCell>
                        )}
                      </TableRow>
                      {open && (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-muted/30 pt-1 pb-4">
                            {editor(host)}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>

            <ul className="divide-y divide-border md:hidden">
              {list.map((host) => {
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
                return (
                  <li key={host.id}>
                    {onSelect ? (
                      <button type="button" onClick={() => onSelect(host)} className="w-full space-y-3 p-4 text-left transition-colors outline-none active:bg-muted/60 focus-visible:bg-muted/60">
                        {body}
                      </button>
                    ) : (
                      <div className="space-y-3 p-4">
                        {body}
                        {editableBrands && (
                          <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setOpenId(open ? null : host.id)} aria-expanded={open}>
                            Atur brand
                            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
                          </Button>
                        )}
                        {open && editor(host)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {hosts.data && <Pagination page={hosts.data.current_page} lastPage={hosts.data.last_page} total={hosts.data.total} unit="host" onChange={(next) => void setUrlState({ page: next })} />}
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
