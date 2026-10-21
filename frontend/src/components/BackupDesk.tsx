"use client";

import { useLayoutEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileWarning,
  Hourglass,
  Inbox,
  Plus,
  Search,
  Star,
  UserRoundPlus,
  X,
} from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { errorMessage, operatorBackupApi, scheduleApi, type BackupCandidate, type BackupReason, type BackupRequest } from "@/lib/api";
import { formatClock, formatDateTime, formatDay, formatDuration, formatTimeRange, formatWindow, isoWeekday, toDateInput } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { timeUntil, useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import { BackupStatusBadge, LetterBadge, reasonLabels, RequestTypeBadge } from "./BackupBadges";
import ConfirmDialog from "./ConfirmDialog";
import Dialog from "./Dialog";
import DatePicker from "./DatePicker";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import { FieldError } from "./FieldMessage";
import FormActions from "./FormActions";
import FormAlert from "./FormAlert";
import { ListSkeleton } from "./Loading";
import Modal from "./Modal";
import PageHeader from "./PageHeader";
import { NativeSelect } from "./SelectField";
import { notify } from "./Toast";
import UserAvatar from "./UserAvatar";

type Tab = "pending" | "open" | "filled" | "closed";

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

const hoursOf = (backup: BackupRequest) => (new Date(backup.end_at).getTime() - new Date(backup.start_at).getTime()) / 3_600_000;

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;
type Confirm = { title: string; body: string; label: string; run: () => Promise<{ message: string }> } | null;

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
  const now = useNow(60_000);
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

  // Every tab at once (cached): the counts, the "starts soon" list and the recap need them all
  const lists: Record<Tab, ReturnType<typeof useApiData<{ requests: BackupRequest[] }>>> = {
    pending: useApiData("operator-backups-pending", () => operatorBackupApi.list(token, "pending")),
    open: useApiData("operator-backups-open", () => operatorBackupApi.list(token, "open")),
    filled: useApiData("operator-backups-filled", () => operatorBackupApi.list(token, "filled")),
    closed: useApiData("operator-backups-closed", () => operatorBackupApi.list(token, "closed")),
  };
  const current = lists[tab];
  const list = current.data?.requests.filter((backup) => matches(backup, search.trim()));
  const count = (key: Tab) => lists[key].data?.requests.length;

  const active = [...(lists.pending.data?.requests ?? []), ...(lists.open.data?.requests ?? []), ...(lists.filled.data?.requests ?? [])];
  const letters = [...active, ...(lists.closed.data?.requests ?? [])].filter((backup) => backup.letter_status === "due" || backup.letter_status === "late");
  const opened = openId ? [...active, ...(lists.closed.data?.requests ?? [])].find((backup) => backup.id === openId) : undefined;

  // Beside the side column, a page holds as many rows as fit down to the end of "Ringkasan
  // riwayat" (measured at their natural height, so the two columns end on the same line)
  const sideHeight = heights.soon + 16 + heights.recap + 2;
  const fits = Math.floor((sideHeight - heights.toolbar - heights.head - heights.footer - 2) / ROW_HEIGHT);
  const pageSize = wide && heights.soon > 0 && heights.recap > 0 ? Math.max(4, fits) : STACKED_PAGE_SIZE;
  const total = list?.length ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageState, lastPage);
  const rows = list?.slice((page - 1) * pageSize, page * pageSize) ?? [];

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
    const target: Tab = backup.status === "pending" || backup.status === "open" || backup.status === "filled" ? backup.status : "closed";
    setSearch("");
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
          value={lists.pending.data && lists.closed.data ? letters.length : undefined}
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
                onChange={(change) => {
                  setSearch(change.target.value);
                  setPage(1);
                }}
                placeholder="Cari host, brand, atau alasan…"
                aria-label="Cari permintaan backup"
                className={cn(inputClass, "pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden")}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
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
          <StartingSoon ref={soonRef} requests={active} now={now} loading={!lists.pending.data || !lists.open.data || !lists.filled.data} onShow={show} />
          <Recap innerRef={recapRef} requests={lists.closed.data?.requests} className="min-[1440px]:flex-1" />
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

const statTones = {
  warning: "bg-warning/12 text-warning",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  danger: "bg-destructive/10 text-destructive",
};

/** A count that also opens its tab. */
function Stat({
  icon: Icon,
  tone,
  label,
  value,
  note,
  active,
  onClick,
}: {
  icon: typeof Inbox;
  tone: keyof typeof statTones;
  label: string;
  value: number | undefined;
  note: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-card p-4 text-left shadow-xs transition-colors outline-none hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5 dark:shadow-none",
        active ? "border-primary/40 ring-1 ring-primary/20" : "border-border"
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", statTones[tone])}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </span>
      <span className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value ?? "–"}</span>
      <span className="mt-0.5 truncate text-xs text-muted-foreground">{note}</span>
    </button>
  );
}

/** The next sessions that have (or had) a backup request, soonest first. */
function StartingSoon({
  ref,
  requests,
  now,
  loading,
  onShow,
}: {
  ref: (node: HTMLElement | null) => void;
  requests: BackupRequest[];
  now: Date;
  loading: boolean;
  onShow: (backup: BackupRequest) => void;
}) {
  const soon = requests
    .filter((backup) => new Date(backup.end_at) > now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .slice(0, 5);

  return (
    <section ref={ref} className="rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">Mulai segera</h2>
      </header>
      {loading ? (
        <div className="p-4">
          <ListSkeleton rows={3} />
        </div>
      ) : soon.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">Tidak ada sesi mendatang yang perlu backup.</p>
      ) : (
        <ul className="divide-y divide-border">
          {soon.map((backup) => {
            const started = new Date(backup.start_at) <= now;
            return (
              <li key={backup.id}>
                <button
                  type="button"
                  onClick={() => onShow(backup)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                >
                  {backup.requester && <UserAvatar user={backup.requester.user} size="size-8 text-xs" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{backup.requester?.user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {backup.brand.name} · {formatClock(backup.start_at)}–{formatClock(backup.end_at)}
                    </span>
                    <span className={cn("mt-1 block text-xs font-medium", backup.status === "filled" ? "text-success" : "text-warning")}>
                      {backup.status === "filled"
                        ? `Aman · ${backup.filler?.user.name ?? "ada pengganti"}`
                        : backup.status === "pending"
                          ? "Perlu diputuskan"
                          : "Belum ada pendaftar"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {started ? "berjalan" : timeUntil(new Date(backup.start_at), now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** How past requests turned out, and who covered most. */
/** `innerRef` measures the content at its natural height (the card itself may stretch). */
function Recap({
  requests,
  className,
  innerRef,
}: {
  requests: BackupRequest[] | undefined;
  className?: string;
  innerRef: (node: HTMLDivElement | null) => void;
}) {
  const total = requests?.length ?? 0;
  const filled = requests?.filter((backup) => backup.status === "filled") ?? [];
  const auto = filled.filter((backup) => backup.auto_filled).length;
  const dropped = total - filled.length;
  const covers = new Map<string, { name: string; avatar_url: string | null; count: number }>();
  for (const backup of filled) {
    if (!backup.filler) continue;
    const entry = covers.get(backup.filler.user.id) ?? { name: backup.filler.user.name, avatar_url: backup.filler.user.avatar_url, count: 0 };
    covers.set(backup.filler.user.id, { ...entry, count: entry.count + 1 });
  }
  const top = [...covers.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "id")).slice(0, 3);
  const rate = total > 0 ? Math.round((filled.length / total) * 100) : 0;

  return (
    <section className={cn("rounded-xl border border-border bg-card shadow-xs dark:shadow-none", className)}>
      <div ref={innerRef}>
        <header className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Ringkasan riwayat</h2>
          <span className="text-xs text-muted-foreground">{total >= 100 ? "100 terakhir" : `${total} permintaan`}</span>
        </header>
        {!requests ? (
          <div className="p-4">
            <ListSkeleton rows={2} />
          </div>
        ) : total === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">Belum ada riwayat backup.</p>
        ) : (
          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Terisi</span>
                <span className="font-semibold text-foreground tabular-nums">{rate}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Permintaan terisi"
                aria-valuenow={rate}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full rounded-full bg-success" style={{ width: `${rate}%` }} />
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ["Terisi", filled.length],
                  ["Otomatis", auto],
                  ["Tidak terisi", dropped],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col-reverse rounded-lg bg-muted/50 px-2 py-2">
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold text-foreground tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {top.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Paling sering menggantikan</p>
                <ul className="space-y-2">
                  {top.map((cover, index) => (
                    <li key={cover.name} className="flex items-center gap-2.5 text-sm">
                      <span className="w-3 text-xs font-semibold text-faint tabular-nums">{index + 1}</span>
                      <UserAvatar user={{ name: cover.name, avatar_url: cover.avatar_url }} size="size-6 text-[10px]" />
                      <span className="min-w-0 flex-1 truncate text-foreground">{cover.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{cover.count}×</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** "Sab", "17", "Okt" in a tile, like a calendar page. */
function DateTile({ iso }: { iso: string }) {
  const date = new Date(iso);
  return (
    <span className="flex w-14 shrink-0 flex-col items-center self-start rounded-lg border border-border bg-muted/40 py-1.5 leading-tight" aria-hidden="true">
      <span className="text-[11px] font-medium text-muted-foreground uppercase">{date.toLocaleDateString("id-ID", { weekday: "short" })}</span>
      <span className="text-xl font-semibold text-foreground tabular-nums">{date.getDate()}</span>
      <span className="text-[11px] text-muted-foreground">{date.toLocaleDateString("id-ID", { month: "short" })}</span>
    </span>
  );
}

/** One line of the table; the row (or its button) opens the details. */
function BackupRow({ backup, onOpen }: { backup: BackupRequest; onOpen: () => void }) {
  const running = new Date(backup.end_at) > new Date();
  const waiting = backup.status === "open" || backup.status === "pending";
  const nominees = backup.nominees?.length ?? 0;

  return (
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(key) => {
        if (key.target === key.currentTarget && (key.key === "Enter" || key.key === " ")) {
          key.preventDefault();
          onOpen();
        }
      }}
      className={cn("h-16 cursor-pointer transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/50", !running && "text-muted-foreground")}
    >
      <td className="px-4 py-2 whitespace-nowrap">
        <span className="block font-medium text-foreground">{formatDay(backup.start_at)}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatClock(backup.start_at)}–{formatClock(backup.end_at)} · {formatDuration(hoursOf(backup))}
        </span>
      </td>
      <td className="max-w-56 px-3 py-2">
        <span className="flex items-center gap-2.5">
          {backup.requester && <UserAvatar user={backup.requester.user} size="size-8 text-xs" />}
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{backup.requester?.user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{backup.brand.name}</span>
          </span>
        </span>
      </td>
      <td className="hidden max-w-48 px-3 py-2 lg:table-cell">
        <span className="block text-foreground">{reasonLabels[backup.reason_type]}</span>
        <span className="block truncate text-xs text-muted-foreground" title={backup.reason ?? undefined}>
          {backup.reason ?? "–"}
        </span>
      </td>
      <td className="max-w-48 px-3 py-2">
        {backup.status === "filled" && backup.filler ? (
          <span className="flex items-center gap-1.5 font-medium text-success">
            <UserAvatar user={backup.filler.user} size="size-5 text-[9px]" />
            <span className="truncate">{backup.filler.user.name}</span>
          </span>
        ) : waiting ? (
          <>
            <span className="block text-foreground tabular-nums">{backup.applicants_count ?? 0} pendaftar</span>
            {nominees > 0 && <span className="block text-xs text-muted-foreground">diminta ke {nominees} host</span>}
          </>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      <td className="hidden px-3 py-2 xl:table-cell">
        {backup.letter_status === "not_needed" ? <span className="text-muted-foreground">–</span> : <LetterBadge status={backup.letter_status} />}
      </td>
      <td className="px-3 py-2">
        <BackupStatusBadge status={backup.status} />
      </td>
      <td className="px-4 py-2 text-right">
        <Button
          type="button"
          size="sm"
          variant={running && waiting ? "default" : "outline"}
          onClick={(click) => {
            click.stopPropagation();
            onOpen();
          }}
        >
          {running && backup.status === "pending" ? "Cek pendaftar" : running && backup.status === "open" ? "Tunjuk" : "Detail"}
        </Button>
      </td>
    </tr>
  );
}

/** Everything about one request, with its actions; shown in the side panel. */
function RequestDetail({ backup, act, onConfirm }: { backup: BackupRequest; act: Act; onConfirm: (confirm: Confirm) => void }) {
  const { token } = useAuth();
  const [choosing, setChoosing] = useState(backup.status === "pending" && new Date(backup.end_at) > new Date());
  const [letterError, setLetterError] = useState<string | null>(null);
  const running = new Date(backup.end_at) > new Date();
  const waiting = backup.status === "open" || backup.status === "pending";
  const nomineeNames = backup.nominees?.map((nominee) => nominee.host.user.name) ?? [];
  const hours = hoursOf(backup);

  async function openLetter() {
    // Open the tab during the click (popup blockers), then point it at the downloaded file
    const tab = window.open("", "_blank");
    try {
      const url = await operatorBackupApi.letterUrl(token, backup.id);
      if (tab) tab.location.href = url;
    } catch (caught) {
      tab?.close();
      setLetterError(errorMessage(caught));
    }
  }

  return (
    <div className="@container overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex gap-4 p-4">
        <DateTile iso={backup.start_at} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              {backup.requester && <UserAvatar user={backup.requester.user} size="size-8 text-xs" />}
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{backup.requester?.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{backup.brand.name}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <RequestTypeBadge names={nomineeNames} />
              <BackupStatusBadge status={backup.status} />
            </div>
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm @lg:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Sesi</dt>
              <dd className="flex items-center gap-1.5 font-medium whitespace-nowrap text-foreground tabular-nums">
                <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {formatClock(backup.start_at)}–{formatClock(backup.end_at)}
                <span className="font-normal text-muted-foreground">· {formatDuration(hours)}</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Alasan</dt>
              <dd className="truncate text-foreground" title={backup.reason ?? undefined}>
                {reasonLabels[backup.reason_type]}
                {backup.reason && <span className="text-muted-foreground"> · {backup.reason}</span>}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{backup.status === "filled" ? "Pengganti" : "Pendaftar"}</dt>
              <dd className="truncate text-foreground">
                {backup.status === "filled" && backup.filler ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-success">
                    <UserAvatar user={backup.filler.user} size="size-5 text-[9px]" />
                    {backup.filler.user.name}
                  </span>
                ) : waiting ? (
                  <>
                    <span className="font-medium tabular-nums">{backup.applicants_count ?? 0}</span> host
                  </>
                ) : (
                  <span className="text-muted-foreground">–</span>
                )}
              </dd>
            </div>
          </dl>

          {(backup.letter_status !== "not_needed" || (waiting && running) || backup.status === "filled") && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {backup.letter_status !== "not_needed" && (
                <span className="flex items-center gap-2">
                  <LetterBadge status={backup.letter_status} />
                  {backup.letter_status === "uploaded" && (
                    <button type="button" onClick={openLetter} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                      Lihat
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </button>
                  )}
                </span>
              )}
              {waiting && running && <span>Pendaftar terbaik disetujui otomatis {formatDateTime(backup.auto_fill_at)}</span>}
              {backup.status === "filled" && (
                <span>
                  {backup.auto_filled ? "Disetujui otomatis" : "Disetujui admin"}
                  {backup.counts_toward_quota && " · brand lain, memakai kuota"}
                  {" · "}
                  {backup.cover_paid_by === "agency"
                    ? "dibayar agensi"
                    : backup.cover_paid_by === "requester"
                      ? `dibayar langsung oleh ${backup.requester?.user.name ?? "host yang minta"}`
                      : "pembayar menunggu surat sakit"}
                </span>
              )}
            </div>
          )}
          {letterError && <FormAlert tone="error">{letterError}</FormAlert>}
        </div>
      </div>

      {running && ["pending", "open", "filled"].includes(backup.status) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-4 py-3">
          {waiting && (
            <Button type="button" size="sm" variant={choosing ? "outline" : "default"} onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
              {choosing ? "Tutup" : backup.status === "pending" ? "Cek pendaftar" : "Tunjuk pengganti"}
              <ChevronDown className={cn("transition-transform", choosing && "rotate-180")} aria-hidden="true" />
            </Button>
          )}
          {backup.status === "filled" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onConfirm({
                  title: "Ganti pengganti?",
                  body: `${backup.filler?.user.name ?? "Pengganti"} dilepas tanpa penalti dan permintaan dibuka lagi.`,
                  label: "Lepas pengganti",
                  run: () => operatorBackupApi.unassign(token, backup.id),
                })
              }
            >
              Ganti pengganti
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() =>
              onConfirm({
                title: "Batalkan permintaan backup?",
                body: `Permintaan ${backup.requester?.user.name ?? "host"} untuk ${backup.brand.name}, ${formatWindow(backup.start_at, backup.end_at)}, dibatalkan seluruhnya.`,
                label: "Batalkan permintaan",
                run: () => operatorBackupApi.cancel(token, backup.id),
              })
            }
          >
            Batalkan permintaan
          </Button>
        </div>
      )}

      {choosing && waiting && (
        <div className="border-t border-border p-4">
          <CoverPicker backup={backup} act={act} onConfirm={onConfirm} />
        </div>
      )}
    </div>
  );
}

/** Applicants (ranked) plus, on demand, every other host for emergencies. */
function CoverPicker({ backup, act, onConfirm }: { backup: BackupRequest; act: Act; onConfirm: (confirm: Confirm) => void }) {
  const { token } = useAuth();
  const [showEveryone, setShowEveryone] = useState(false);
  const applicants = useApiData(`backup-applicants-${backup.id}`, () => operatorBackupApi.applicants(token, backup.id));
  const everyone = useApiData(`backup-everyone-${backup.id}-${showEveryone}`, () =>
    showEveryone ? operatorBackupApi.candidates(token, backup.id) : Promise.resolve({ candidates: [] })
  );

  const pick = (candidate: BackupCandidate) => act(() => operatorBackupApi.assign(token, backup.id, candidate.host_id));
  const reject = (candidate: BackupCandidate) =>
    onConfirm({
      title: `Tolak ${candidate.name}?`,
      body: "Kalau tidak ada pendaftar lain, permintaan dibuka lagi.",
      label: "Tolak pendaftar",
      run: () => operatorBackupApi.rejectApplicant(token, backup.id, candidate.host_id),
    });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">Pendaftar, terbaik di atas (rating tertinggi, lalu brand yang sama, lalu yang mendaftar paling awal).</p>
      {!applicants.data && <ListSkeleton rows={2} />}
      {applicants.data?.applicants.length === 0 && <p className="text-sm text-muted-foreground">Belum ada yang mendaftar.</p>}
      <CandidateList candidates={applicants.data?.applicants ?? []} onPick={pick} onReject={reject} />

      {showEveryone ? (
        <>
          <p className="pt-2 text-xs text-muted-foreground">Semua host (untuk darurat; tidak harus sudah mendaftar atau diminta).</p>
          {everyone.loading && !everyone.data?.candidates.length && <ListSkeleton rows={3} />}
          <CandidateList candidates={everyone.data?.candidates ?? []} onPick={pick} />
        </>
      ) : (
        <Button type="button" variant="link" size="sm" onClick={() => setShowEveryone(true)} className="h-auto px-0">
          <UserRoundPlus aria-hidden="true" />
          Tunjuk host yang tidak mendaftar
        </Button>
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  onPick,
  onReject,
}: {
  candidates: BackupCandidate[];
  onPick: (candidate: BackupCandidate) => void;
  /** Only for applicants */
  onReject?: (candidate: BackupCandidate) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {candidates.map((candidate, index) => (
        <li key={candidate.host_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          {onReject && <span className="w-4 text-center text-xs font-semibold text-faint tabular-nums">{index + 1}</span>}
          <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="size-8 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{candidate.name}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {candidate.rating != null && (
                <span className="inline-flex items-center gap-0.5 font-medium text-foreground tabular-nums">
                  <Star className="size-3 fill-warning text-warning" aria-hidden="true" />
                  {candidate.rating.toFixed(1)}
                </span>
              )}
              <span>{candidate.same_brand ? "Brand yang sama" : `Brand lain · kuota ${candidate.quota.quota_used}/${candidate.quota.quota_max}`}</span>
              {candidate.ineligible_reason && <span className="text-destructive">· {candidate.ineligible_reason}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {onReject && (
              <Button type="button" size="sm" variant="outline" onClick={() => onReject(candidate)}>
                Tolak
              </Button>
            )}
            <Button type="button" size="sm" variant="success" disabled={!candidate.eligible} onClick={() => onPick(candidate)}>
              Setujui
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Emergency: open a request for a host who called in, e.g. by phone. */
function OnBehalfForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const [date, setDate] = useState(toDateInput());
  const [reasonType, setReasonType] = useState<BackupReason>("sick");
  const slots = useApiData(`schedules-on-${date}`, () => scheduleApi.list(token, { on: date }));
  const weekday = isoWeekday(new Date(`${date}T00:00`));
  const daySlots = slots.data?.slots.filter((slot) => slot.day_of_week === weekday) ?? [];

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      operatorBackupApi.create(token, {
        slot_id: formValue(data, "slot_id"),
        backup_date: date,
        reason_type: reasonType,
        reason: formValue(data, "reason") || null,
      }),
    ({ message }) => onDone(message)
  );

  return (
    <Modal title="Ajukan backup untuk host" description="Langsung muncul di papan backup, juga untuk sesi yang akan segera mulai." onClose={onCancel}>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-date">Tanggal</Label>
          <DatePicker id="on-behalf-date" value={date} min={toDateInput()} onChange={setDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-slot">Sesi</Label>
          <NativeSelect id="on-behalf-slot" name="slot_id" disabled={daySlots.length === 0}>
            {daySlots.length === 0 && <option>{slots.loading ? "Memuat sesi…" : "Tidak ada sesi di hari itu"}</option>}
            {daySlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.assignment.host?.user.name} · {slot.assignment.brand.name} · {formatTimeRange(slot.start_time, slot.end_time, slot.day_of_week)}
              </option>
            ))}
          </NativeSelect>
          <FieldError>{errors.slot_id ?? errors.backup_date}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-reason-type">Alasan</Label>
          <NativeSelect id="on-behalf-reason-type" value={reasonType} onChange={(event) => setReasonType(event.target.value as BackupReason)}>
            {(Object.keys(reasonLabels) as BackupReason[]).map((value) => (
              <option key={value} value={value}>
                {reasonLabels[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="on-behalf-reason">
            Keterangan <span className="font-normal text-muted-foreground">(opsional)</span>
          </Label>
          <input id="on-behalf-reason" name="reason" maxLength={1000} className={inputClass} />
        </div>
        <FormActions loading={loading} submitLabel="Buka permintaan" onCancel={onCancel} disabled={daySlots.length === 0} />
      </form>
    </Modal>
  );
}
