"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { CheckCircle2, FileWarning, Hourglass, Inbox, Plus, Search } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { errorMessage, operatorBackupApi, type BackupReason, type BackupRequest } from "@/lib/api";
import { formatWindow } from "@/lib/format";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import { reasonLabels } from "./BackupBadges";
import ConfirmDialog from "./ConfirmDialog";
import DataTable from "./DataTable";
import Dialog from "./Dialog";
import EmptyState from "./EmptyState";
import FormAlert from "./FormAlert";
import PageHeader from "./PageHeader";
import Pagination from "./Pagination";
import SearchInput from "./SearchInput";
import { notify } from "./Toast";
import ToggleGroup, { ShortLabel } from "./ToggleGroup";
import { DensityToggle, useTableDensity } from "./data-table";
import { BackupMobileCard, createBackupColumns } from "./backups/BackupRow";
import { OnBehalfForm } from "./backups/OnBehalfForm";
import { RequestDetail } from "./backups/RequestDetail";
import { Recap, StartingSoon, Stat } from "./backups/SideCards";
import { type Confirm, type Tab } from "./backups/shared";

// The short labels let a narrow card (a phone) show every tab in a 2×2 grid instead of scrolling sideways
const tabs: { value: Tab; label: string; short: string }[] = [
  { value: "pending", label: "Perlu diputuskan", short: "Perlu putusan" },
  { value: "open", label: "Belum ada pendaftar", short: "Belum ada" },
  { value: "filled", label: "Sudah ada pengganti", short: "Ada pengganti" },
  { value: "closed", label: "Riwayat", short: "Riwayat" },
];

const emptyText: Record<Tab, string> = {
  pending: "Tidak ada pendaftar yang menunggu keputusan.",
  open: "Semua permintaan sudah ada pendaftarnya.",
  filled: "Belum ada backup yang terisi untuk sesi mendatang.",
  closed: "Belum ada riwayat backup.",
};

/** Table rows are this tall, so the rows that fit beside the side column can be counted. */
const ROW_HEIGHT = 64;
/** Rows per page when the side column is underneath (below 1440px). */
const STACKED_PAGE_SIZE = 8;
/** The server's page size for the closed tab. */
const CLOSED_PAGE_SIZE = 25;

/** An element's height, kept up to date; pass the setter as the element's `ref` (it may mount later). */
function useHeight<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, height];
}

/** Reason types whose label matches a search, e.g. "sak" → sick (the server searches the other fields). */
const reasonsMatching = (query: string): BackupReason[] =>
  query ? (Object.keys(reasonLabels) as BackupReason[]).filter((reason) => reasonLabels[reason].toLowerCase().includes(query.toLowerCase())) : [];

const matches = (backup: BackupRequest, query: string) =>
  !query ||
  [backup.requester?.user.name, backup.filler?.user.name, backup.brand.name, backup.reason, reasonLabels[backup.reason_type]]
    .filter(Boolean)
    .some((text) => text!.toLowerCase().includes(query.toLowerCase()));

/**
 * Admin/operator backup desk: what needs a decision at a glance, the requests by status, and
 * on the side what starts soon, how backups went lately and the rules in force.
 */
export default function BackupDesk() {
  const { token } = useAuth();
  const invalidate = useInvalidate();
  // The tab lives in the URL, so a refresh or the Back button keeps it
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(tabs.map((option) => option.value)).withDefault("pending"));
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [density, setDensity] = useTableDensity();
  const [pageState, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1440px)");
  const [toolbarRef, toolbarHeight] = useHeight<HTMLDivElement>();
  const [footerRef, footerHeight] = useHeight<HTMLDivElement>();
  const [soonRef, soonHeight] = useHeight<HTMLElement>();
  const [recapRef, recapHeight] = useHeight<HTMLDivElement>();
  const heights = { toolbar: toolbarHeight, footer: footerHeight, soon: soonHeight, recap: recapHeight };

  // The upcoming tabs at once (cached): the counts and the "starts soon" list need them all
  const lists: Record<Exclude<Tab, "closed">, ReturnType<typeof useApiData<{ requests: BackupRequest[]; total: number }>>> = {
    pending: useApiData("operator-backups-pending", () => operatorBackupApi.list(token, "pending")),
    open: useApiData("operator-backups-open", () => operatorBackupApi.list(token, "open")),
    filled: useApiData("operator-backups-filled", () => operatorBackupApi.list(token, "filled")),
  };
  // History grows forever: paged and searched on the server, loaded once its tab is open
  const [closedSearch, setClosedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setClosedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const closedPage = tab === "closed" ? pageState : 1;
  const closed = useApiData(
    `operator-backups-closed|${closedPage}|${closedSearch}`,
    () => operatorBackupApi.closed(token, { page: closedPage, search: closedSearch, reason_types: reasonsMatching(closedSearch) }),
    { enabled: tab === "closed", keepPrevious: true }
  );
  const lettersDue = useApiData("operator-backups-letters", () => operatorBackupApi.letters(token));
  const recap = useApiData("operator-backups-recap", () => operatorBackupApi.recap(token));

  const current = tab === "closed" ? closed : lists[tab];
  const list = tab === "closed" ? closed.data?.requests : lists[tab].data?.requests.filter((backup) => matches(backup, search.trim()));
  const count = (key: Tab) => (key === "closed" ? closed.data?.total : lists[key].data?.total);

  const active = [...(lists.pending.data?.requests ?? []), ...(lists.open.data?.requests ?? []), ...(lists.filled.data?.requests ?? [])];
  const letters = lettersDue.data?.requests ?? [];
  const opened = openId ? [...active, ...(closed.data?.requests ?? []), ...letters].find((backup) => backup.id === openId) : undefined;

  // Beside the side column, a page holds as many rows as fit down to the end of "Ringkasan
  // riwayat" (measured at their natural height, so the two columns end on the same line)
  const rowHeight = density === "compact" ? 48 : ROW_HEIGHT;
  const headerHeight = 44;
  const sideHeight = heights.soon + 16 + heights.recap + 2;
  const fits = Math.floor((sideHeight - heights.toolbar - headerHeight - heights.footer - 2) / rowHeight);
  const serverPaged = tab === "closed";
  const pageSize = serverPaged ? CLOSED_PAGE_SIZE : wide && heights.soon > 0 && heights.recap > 0 ? Math.max(4, fits) : STACKED_PAGE_SIZE;
  const total = (serverPaged ? closed.data?.total : list?.length) ?? 0;
  const lastPage = serverPaged ? (closed.data?.last_page ?? 1) : Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageState, lastPage);
  const rows = (serverPaged ? list : list?.slice((page - 1) * pageSize, page * pageSize)) ?? [];

  const columns = createBackupColumns(tab, (backup) => setOpenId(backup.id));

  function changeSearch(next: string) {
    setSearch(next);
    setPage(1);
  }

  function chooseTab(next: Tab) {
    void setTab(next);
    setPage(1);
  }

  async function act(action: () => Promise<{ message: string }>) {
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    await invalidate("operator-backups-");
  }

  /** From the side column or the counts: the request's tab, and its details opened. */
  function show(backup: BackupRequest) {
    const upcoming = new Date(backup.end_at) > new Date();
    const target: Tab = upcoming && (backup.status === "pending" || backup.status === "open" || backup.status === "filled") ? backup.status : "closed";
    changeSearch("");
    chooseTab(target);
    setOpenId(backup.id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup"
        description="Host memasang permintaan di papan backup; setujui pendaftar terbaik, atau tunjuk pengganti sendiri saat darurat."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Ajukan untuk host
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          icon={Hourglass}
          tone="warning"
          label="Perlu diputuskan"
          value={count("pending")}
          note="Pendaftar menunggu ACC"
          active={tab === "pending"}
          onClick={() => chooseTab("pending")}
        />
        <Stat
          icon={Search}
          tone="info"
          label="Mencari pengganti"
          value={count("open")}
          note="Belum ada yang mendaftar"
          active={tab === "open"}
          onClick={() => chooseTab("open")}
        />
        <Stat
          icon={CheckCircle2}
          tone="success"
          label="Sudah ada pengganti"
          value={count("filled")}
          note="Sesi mendatang yang aman"
          active={tab === "filled"}
          onClick={() => chooseTab("filled")}
        />
        <Stat
          icon={FileWarning}
          tone="danger"
          label="Surat sakit"
          value={lettersDue.data?.total}
          note={letters.some((backup) => backup.letter_status === "late") ? "Ada yang terlambat" : "Belum diunggah host"}
          active={false}
          onClick={() => letters[0] && show(letters[0])}
        />
      </div>

      <div className="grid gap-6 min-[1440px]:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="@container flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div ref={toolbarRef} className="flex flex-col gap-3 border-b border-border p-4 @[58rem]:flex-row @[58rem]:items-center @[58rem]:justify-between">
            <ToggleGroup
              label="Status backup"
              grid
              value={tab}
              onChange={chooseTab}
              options={tabs.map((option) => {
                const optionTotal = count(option.value);
                return {
                  value: option.value,
                  label: (
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <ShortLabel short={option.short} full={option.label} />
                      {optionTotal !== undefined && option.value !== "closed" && (
                        <span
                          className={cn(
                            "rounded-full px-1.5 text-[11px] leading-[18px] font-semibold tabular-nums",
                            optionTotal > 0 && option.value === "pending" ? "bg-warning-subtle text-warning" : "bg-foreground/5 text-muted-foreground"
                          )}
                        >
                          {optionTotal}
                        </span>
                      )}
                    </span>
                  ),
                };
              })}
            />

            <div className="flex items-center gap-2">
              <SearchInput
                value={search}
                onChange={changeSearch}
                placeholder="Cari host, brand, atau alasan…"
                aria-label="Cari permintaan backup"
                className="min-w-0 flex-1 @[58rem]:w-64 @[58rem]:flex-none"
              />
              <DensityToggle density={density} onChange={setDensity} className="hidden md:inline-flex" />
            </div>
          </div>

          {error && (
            <div className="border-b border-border p-4">
              <FormAlert tone="error">{error}</FormAlert>
            </div>
          )}

          <div className={cn("flex-1", current.error && rows.length === 0 && "p-4")}>
            <DataTable<BackupRequest>
              columns={columns}
              data={rows}
              getRowId={(row) => row.id}
              density={density}
              stickyHeader
              stickyFirstColumn
              maxHeightClassName="max-h-none"
              loading={!list && !current.error}
              reloading={current.loading && Boolean(list)}
              error={current.error}
              onRetry={current.reload}
              onRowClick={(backup) => setOpenId(backup.id)}
              rowOpensDialog
              rowClassName={(backup) => (new Date(backup.end_at) <= new Date() ? "text-muted-foreground" : undefined)}
              renderMobile={(backup) => <BackupMobileCard backup={backup} onOpen={() => setOpenId(backup.id)} />}
              empty={
                <EmptyState
                  icon={Inbox}
                  title={search ? "Tidak ada yang cocok" : "Tidak ada data"}
                  description={search ? `Tidak ada permintaan dengan "${search}" di tab ini.` : emptyText[tab]}
                  action={
                    tab !== "closed" && !search ? (
                      <Button type="button" variant="outline" onClick={() => setCreating(true)}>
                        <Plus aria-hidden="true" />
                        Ajukan untuk host
                      </Button>
                    ) : undefined
                  }
                />
              }
              className="rounded-none border-0 shadow-none"
            />
          </div>

          <div ref={footerRef} className="border-t border-border px-4 py-3">
            {lastPage > 1 ? (
              <Pagination page={page} lastPage={lastPage} total={total} unit="permintaan" pageSize={pageSize} onChange={setPage} />
            ) : (
              <p className="text-xs text-muted-foreground tabular-nums">{total > 0 ? `Menampilkan ${total} permintaan` : "Tidak ada permintaan"}</p>
            )}
          </div>
        </section>

        {/* Beside the list from 1440px: the recap stretches so both columns end on the same line */}
        <aside className="grid items-start gap-4 min-[1440px]:flex min-[1440px]:flex-col min-[1440px]:items-stretch md:max-[1439px]:grid-cols-2">
          <StartingSoon ref={soonRef} requests={active} loading={!lists.pending.data || !lists.open.data || !lists.filled.data} onShow={show} />
          <Recap innerRef={recapRef} recap={recap.data} className="min-[1440px]:flex-1" />
        </aside>
      </div>

      {creating && (
        <OnBehalfForm
          onDone={(message) => {
            setCreating(false);
            notify({ text: message });
            void setTab("open");
            void invalidate("operator-backups-");
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {opened && (
        <Dialog
          placement="side"
          size="lg"
          title="Detail backup"
          description={`${opened.requester?.user.name ?? "Host"} · ${opened.brand.name} · ${formatWindow(opened.start_at, opened.end_at)}`}
          onClose={() => setOpenId(null)}
        >
          <RequestDetail key={opened.id} backup={opened} act={act} onConfirm={setConfirm} />
        </Dialog>
      )}

      {confirm && (
        <ConfirmDialog title={confirm.title} confirmLabel={confirm.label} onConfirm={() => act(confirm.run)} onClose={() => setConfirm(null)}>
          {confirm.body}
        </ConfirmDialog>
      )}
    </div>
  );
}
