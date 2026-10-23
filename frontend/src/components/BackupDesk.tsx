"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, FileWarning, Hourglass, Inbox, Plus, Search, X } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { errorMessage, operatorBackupApi, type BackupReason, type BackupRequest } from "@/lib/api";
import { formatClock, formatDay, formatWindow } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import { BackupStatusBadge, reasonLabels } from "./BackupBadges";
import ConfirmDialog from "./ConfirmDialog";
import Dialog from "./Dialog";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import FormAlert from "./FormAlert";
import { ListSkeleton } from "./Loading";
import PageHeader from "./PageHeader";
import { notify } from "./Toast";
import UserAvatar from "./UserAvatar";
import { BackupRow } from "./backups/BackupRow";
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
  const [pageState, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1440px)");
  const [toolbarRef, toolbarHeight] = useHeight<HTMLDivElement>();
  const [headRef, headHeight] = useHeight<HTMLTableSectionElement>();
  const [footerRef, footerHeight] = useHeight<HTMLDivElement>();
  const [soonRef, soonHeight] = useHeight<HTMLElement>();
  const [recapRef, recapHeight] = useHeight<HTMLDivElement>();
  const heights = { toolbar: toolbarHeight, head: headHeight, footer: footerHeight, soon: soonHeight, recap: recapHeight };

  // The upcoming tabs at once (cached): the counts and the "starts soon" list need them all
  const lists: Record<Exclude<Tab, "closed">, ReturnType<typeof useApiData<{ requests: BackupRequest[]; total: number }>>> = {
    pending: useApiData("operator-backups-pending", () => operatorBackupApi.list(token, "pending")),
    open: useApiData("operator-backups-open", () => operatorBackupApi.list(token, "open")),
    filled: useApiData("operator-backups-filled", () => operatorBackupApi.list(token, "filled")),
  };
  // History grows forever: paged and searched on the server, loaded once its tab is open
  const [closedSearch, setClosedSearch] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(debounce.current), []);
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
  const sideHeight = heights.soon + 16 + heights.recap + 2;
  const fits = Math.floor((sideHeight - heights.toolbar - heights.head - heights.footer - 2) / ROW_HEIGHT);
  const serverPaged = tab === "closed";
  const pageSize = serverPaged ? CLOSED_PAGE_SIZE : wide && heights.soon > 0 && heights.recap > 0 ? Math.max(4, fits) : STACKED_PAGE_SIZE;
  const total = (serverPaged ? closed.data?.total : list?.length) ?? 0;
  const lastPage = serverPaged ? (closed.data?.last_page ?? 1) : Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageState, lastPage);
  const rows = (serverPaged ? list : list?.slice((page - 1) * pageSize, page * pageSize)) ?? [];

  function changeSearch(next: string) {
    setSearch(next);
    setPage(1);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setClosedSearch(next.trim()), 300);
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
          <Button type="button" size="lg" onClick={() => setCreating(true)}>
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
        <section className="@container flex min-w-0 flex-col rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
          <div ref={toolbarRef} className="flex flex-col gap-3 border-b border-border p-4 @[58rem]:flex-row @[58rem]:items-center @[58rem]:justify-between">
            <div
              role="radiogroup"
              aria-label="Status backup"
              className="grid max-w-full [scrollbar-width:none] grid-cols-2 gap-1 overflow-x-auto rounded-lg bg-muted p-1 @xl:flex"
            >
              {tabs.map((option) => {
                const selected = tab === option.value;
                const total = count(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => chooseTab(option.value)}
                    className={cn(
                      "flex h-9 min-w-0 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 @xl:shrink-0 @xl:px-3",
                      selected ? "bg-card text-foreground shadow-xs ring-1 ring-foreground/5 dark:bg-secondary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span aria-hidden="true" className="truncate @xl:hidden">
                      {option.short}
                    </span>
                    <span className="sr-only @xl:not-sr-only">{option.label}</span>
                    {total !== undefined && option.value !== "closed" && (
                      <span
                        className={cn(
                          "min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
                          total > 0 && option.value === "pending" ? "bg-warning/15 text-warning" : "bg-foreground/5 text-muted-foreground"
                        )}
                      >
                        {total}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="relative @[58rem]:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(change) => changeSearch(change.target.value)}
                placeholder="Cari host, brand, atau alasan…"
                aria-label="Cari permintaan backup"
                className={cn(inputClass, "pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden")}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => changeSearch("")}
                  aria-label="Hapus pencarian"
                  className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground md:right-2 md:size-6"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {(error || current.error) && (
            <div className="space-y-3 border-b border-border p-4">
              {error && <FormAlert tone="error">{error}</FormAlert>}
              {current.error && <ErrorState message={current.error} onRetry={current.reload} />}
            </div>
          )}

          <div className={cn("flex-1 transition-opacity", current.loading && list && "opacity-60")}>
            {!list && !current.error && (
              <div className="p-4">
                <ListSkeleton rows={5} />
              </div>
            )}

            {list?.length === 0 && (
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
            )}

            {list && list.length > 0 && (
              <>
                {/* Phones: one line per request */}
                <ul className="divide-y divide-border md:hidden">
                  {rows.map((backup) => (
                    <li key={backup.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(backup.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:bg-muted/50 active:bg-muted/50"
                      >
                        {backup.requester && <UserAvatar user={backup.requester.user} size="size-9 text-xs" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{backup.requester?.user.name}</span>
                          <span className="block truncate text-xs text-muted-foreground tabular-nums">
                            {formatDay(backup.start_at)} · {formatClock(backup.start_at)}–{formatClock(backup.end_at)} · {backup.brand.name}
                          </span>
                          <span className="mt-1 block">
                            <BackupStatusBadge status={backup.status} />
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>

                <table className="hidden w-full text-sm md:table">
                  <thead ref={headRef} className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Jadwal
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Host
                      </th>
                      <th scope="col" className="hidden px-3 py-2.5 font-medium lg:table-cell">
                        Alasan
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        {tab === "filled" ? "Pengganti" : "Pendaftar / pengganti"}
                      </th>
                      <th scope="col" className="hidden px-3 py-2.5 font-medium xl:table-cell">
                        Surat sakit
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">
                        Aksi
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((backup) => (
                      <BackupRow key={backup.id} backup={backup} onOpen={() => setOpenId(backup.id)} />
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div ref={footerRef} className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground tabular-nums">
              {total > 0 ? `Menampilkan ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} dari ${total} permintaan` : "Tidak ada permintaan"}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft aria-hidden="true" />
                Sebelumnya
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {page} / {lastPage}
              </span>
              <Button type="button" variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
                Berikutnya
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
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
