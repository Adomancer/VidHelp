"use client";

import { useState } from "react";
import { useQueryState } from "nuqs";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RotateCcw, Ticket, Trash2 } from "lucide-react";
import { errorMessage, eventApi, operatorApi, scheduleApi, type BrandHost, type EventBlock, type EventInput, type EventListItem, type SpecialEvent } from "@/lib/api";
import { groupByDay } from "@/lib/events";
import { formatClock, formatDay, formatDuration, formatShortDate, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useNow } from "@/lib/useNow";
import { inputClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import ConfirmDialog from "./ConfirmDialog";
import DatePicker from "./DatePicker";
import Dialog from "./Dialog";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import FilterCombobox, { type FilterOption } from "./FilterCombobox";
import FormAlert from "./FormAlert";
import { CardsSkeleton } from "./Loading";
import PageHeader from "./PageHeader";
import { NativeSelect } from "./SelectField";
import { notifyCapsule } from "./Toast";

/** Main controls are 44px high, for tablets and phones. */
const TALL = "h-11 md:h-11";

/** taken: someone holds it · open: can be given · regular: the brand's own schedule runs · past: over */
type BlockStatus = "taken" | "open" | "regular" | "past";

function statusOf(block: EventBlock, now: Date): BlockStatus {
  if (new Date(block.end_at) <= now) return "past";
  if (block.claim) return "taken";
  if (block.state === "unavailable") return "regular";
  return "open";
}

const blockTime = (block: EventBlock) => `${formatClock(block.start_at)}–${formatClock(block.end_at)}`;
const dayOf = (iso: string) => formatDay(`${iso.slice(0, 10)}T00:00`);
const dateRange = (event: SpecialEvent) => {
  const start = event.start_date.slice(0, 10);
  const end = event.end_date.slice(0, 10);
  return start === end ? formatShortDate(start) : `${formatShortDate(start)} – ${formatShortDate(end)}`;
};

interface HostLite {
  id: string;
  name: string;
}

/** A brand's active hosts, by name. */
function activeHosts(assignments: BrandHost[]): HostLite[] {
  return assignments
    .filter((assignment) => assignment.status === "active")
    .map((assignment) => ({ id: assignment.host_id, name: assignment.host.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
}

/**
 * Admin/operator: special events (PD, double date). Narrow the list by brand, host or event,
 * see every day as a card of blocks, and click a block to give it to a host or take it back.
 */
export default function EventManager() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const now = useNow(30_000);
  const events = useApiData("operator-events", () => eventApi.list(token));
  const [brandId, setBrandId] = useQueryState("brand");
  const [hostId, setHostId] = useQueryState("host");
  const [eventParam, setEventParam] = useQueryState("event");
  const [creating, setCreating] = useState(false);

  const list = events.data?.events ?? [];
  const base = list;

  // Every event's blocks (one request each, cached), for the host filter and its counts
  const detailQueries = useQueries({
    queries: base.map((event) => ({ queryKey: [`operator-event-${event.id}`], queryFn: () => eventApi.show(token, event.id) })),
  });
  const blocksOf = new Map(base.map((event, index) => [event.id, detailQueries[index]?.data?.blocks]));
  const detailsLoading = detailQueries.some((query) => query.isPending);

  // Brand options: brands with events, and how many
  const brandCounts = new Map<string, { name: string; count: number }>();
  for (const event of base) {
    const entry = brandCounts.get(event.brand_id) ?? { name: event.brand?.name ?? "-", count: 0 };
    brandCounts.set(event.brand_id, { ...entry, count: entry.count + 1 });
  }
  const brandOptions: FilterOption[] = [...brandCounts.entries()]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name, "id"))
    .map(([id, { name, count }]) => ({ value: id, label: name, meta: `${count} event` }));

  // Host options: with a brand, that brand's hosts only (with how many of its event blocks
  // they hold); without one, every host holding a block
  const brandHosts = useApiData(`brand-hosts-${brandId ?? ""}`, () => scheduleApi.brandHosts(token, brandId ?? ""), { enabled: Boolean(brandId) });
  const brandHostsReady = !brandId || Boolean(brandHosts.data) || Boolean(brandHosts.error);
  const hostCounts = new Map<string, { name: string; count: number }>();
  for (const event of base.filter((item) => !brandId || item.brand_id === brandId)) {
    for (const block of blocksOf.get(event.id) ?? []) {
      if (!block.claim) continue;
      const entry = hostCounts.get(block.claim.host_id) ?? { name: block.claim.host_name, count: 0 };
      hostCounts.set(block.claim.host_id, { ...entry, count: entry.count + 1 });
    }
  }
  const hostPool: HostLite[] = brandId
    ? activeHosts(brandHosts.data?.assignments ?? [])
    : [...hostCounts.entries()].map(([id, { name }]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "id"));
  const hostOptions: FilterOption[] = hostPool.map((host) => ({ value: host.id, label: host.name, meta: `${hostCounts.get(host.id)?.count ?? 0} blok` }));
  // A host from another brand doesn't filter this one's events
  const hostFilter = hostId && (!brandId || !brandHostsReady || hostPool.some((host) => host.id === hostId)) ? hostId : null;
  const noBrandHosts = Boolean(brandId) && brandHostsReady && hostPool.length === 0;

  const matching = (brand: string | null, host: string | null) =>
    base.filter(
      (event) => (!brand || event.brand_id === brand) && (!host || (blocksOf.get(event.id) ?? []).some((block) => block.claim?.host_id === host))
    );
  const filtered = matching(brandId, hostFilter);
  const eventOptions: FilterOption[] = filtered.map((event) => ({
    value: event.id,
    label: event.name,
    description: `${event.brand?.name ?? "-"} · ${dateRange(event)}`,
    meta: `${event.claimed_blocks}/${event.total_blocks} terisi`,
  }));
  const selected = filtered.find((event) => event.id === eventParam) ?? filtered[0];
  const anyFilter = Boolean(brandId || hostFilter || eventParam);

  /** Changes only mark the shared cache stale, so load what this page shows again now. */
  const refresh = (id: string) =>
    Promise.all([queryClient.invalidateQueries({ queryKey: [`operator-event-${id}`] }), queryClient.invalidateQueries({ queryKey: ["operator-events"] })]);

  // Choosing a brand or host shows the first event that matches
  function chooseBrand(value: string | null) {
    // The chosen host stays only if they're on the new brand; otherwise the filter starts over
    const keepHost = value && hostId && queryClient.getQueryData<{ assignments: BrandHost[] }>([`brand-hosts-${value}`])?.assignments.some((item) => item.host_id === hostId);
    void setBrandId(value);
    if (value && !keepHost) void setHostId(null);
    void setEventParam(matching(value, value && !keepHost ? null : hostId)[0]?.id ?? null);
  }
  function chooseHost(value: string | null) {
    void setHostId(value);
    void setEventParam(matching(brandId, value)[0]?.id ?? null);
  }
  function reset() {
    void setBrandId(null);
    void setHostId(null);
    void setEventParam(null);
  }

  const newEventButton = (
    <Button type="button" size="lg" onClick={() => setCreating(true)} className={TALL}>
      <Plus aria-hidden="true" />
      Event baru
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Event khusus"
        description="PD, double date, dan kampanye lainnya. Host dari brand mengambil blok yang sudah ditentukan; kamu bisa menunjuk atau menarik kembali blok mana pun."
        actions={newEventButton}
      />

      <Card bodyClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto] xl:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="filter-brand">Brand</Label>
          <FilterCombobox id="filter-brand" options={brandOptions} value={brandId} onChange={chooseBrand} placeholder="Semua brand" empty="Brand tidak ditemukan." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="filter-host">Host</Label>
          <FilterCombobox
            id="filter-host"
            options={hostOptions}
            value={hostFilter}
            onChange={chooseHost}
            placeholder={!brandHostsReady || detailsLoading ? "Memuat host…" : noBrandHosts ? "Tidak ada host di brand ini" : "Semua host"}
            empty={brandId ? "Tidak ada host di brand tersebut." : "Belum ada host yang mengambil blok."}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="filter-event">Event</Label>
          <FilterCombobox
            id="filter-event"
            options={eventOptions}
            value={selected?.id ?? null}
            onChange={(value) => void setEventParam(value)}
            placeholder="Pilih event"
            empty="Tidak ada event yang cocok."
          />
        </div>
        <div className="flex items-center md:col-span-2 xl:col-span-1">
          <Button type="button" variant="outline" size="lg" onClick={reset} disabled={!anyFilter} className={TALL}>
            <RotateCcw aria-hidden="true" />
            Reset
          </Button>
        </div>
      </Card>

      {events.error && <ErrorState message={events.error} onRetry={events.reload} />}
      {!events.data && !events.error && <CardsSkeleton count={2} />}

      {events.data && !selected && (hostFilter && detailsLoading ? (
        <CardsSkeleton count={2} />
      ) : (
        <Card>
          <EmptyState
            icon={Ticket}
            title={list.length === 0 ? "Belum ada event" : "Tidak ada event yang cocok"}
            description={
              list.length === 0
                ? "Buat event untuk kampanye PD atau double date. Host dari brand-nya bisa langsung mengambil blok."
                : "Ubah atau reset filternya, atau buat event baru."
            }
            action={newEventButton}
          />
        </Card>
      ))}

      {selected && (
        <EventBoard
          key={selected.id}
          listed={selected}
          highlightHost={hostFilter}
          now={now}
          refresh={refresh}
          onDeleted={async () => {
            // Load the list first so nothing asks for the deleted event again, then drop its cache
            void setEventParam(null);
            await queryClient.invalidateQueries({ queryKey: ["operator-events"] });
            queryClient.removeQueries({ queryKey: [`operator-event-${selected.id}`] });
          }}
        />
      )}

      {creating && (
        <EventForm
          onDone={(message, id) => {
            setCreating(false);
            notifyCapsule(message);
            void setEventParam(id);
            void refresh(id);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}

/** The chosen event: summary, settings, legend, and a card per day. */
function EventBoard({
  listed,
  highlightHost,
  now,
  refresh,
  onDeleted,
}: {
  listed: EventListItem;
  highlightHost: string | null;
  now: Date;
  refresh: (id: string) => Promise<unknown>;
  onDeleted: () => Promise<void>;
}) {
  const { token } = useAuth();
  const detail = useApiData(`operator-event-${listed.id}`, () => eventApi.show(token, listed.id));
  const brandHosts = useApiData(`brand-hosts-${listed.brand_id}`, () => scheduleApi.brandHosts(token, listed.brand_id));
  const [open, setOpen] = useState<EventBlock | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <CardsSkeleton count={2} />;

  const { event, blocks } = detail.data;
  const days = groupByDay(blocks);

  const held = new Map<string, number>();
  for (const block of blocks) if (block.claim) held.set(block.claim.host_id, (held.get(block.claim.host_id) ?? 0) + 1);

  const hosts = activeHosts(brandHosts.data?.assignments ?? []);

  return (
    <div className="space-y-5">
      <Summary event={event} blocks={blocks} days={days.map(([day]) => day)} held={held} now={now} onEdit={() => setEditing(true)} onDelete={() => setDeleting(true)} refresh={() => refresh(event.id)} />

      <Legend />

      {/* Days side by side, earliest on the left: they share the width when few, scroll sideways (snapping to a card's edge) when many */}
      <ul aria-label="Hari event" className="flex snap-x snap-mandatory items-start gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
        {days.map(([day, dayBlocks]) => (
          <li key={day} className="min-w-[85%] flex-1 basis-0 snap-start sm:min-w-[300px]">
            <DayCard day={day} blocks={dayBlocks} now={now} highlightHost={highlightHost} onOpen={setOpen} />
          </li>
        ))}
      </ul>

      {open && (
        <AssignDialog
          event={event}
          block={open}
          hosts={hosts}
          hostsLoading={!brandHosts.data && !brandHosts.error}
          held={held}
          onClose={() => setOpen(null)}
          onDone={async () => {
            setOpen(null);
            await refresh(event.id);
          }}
        />
      )}

      {editing && (
        <EventForm
          event={event}
          onDone={(message) => {
            setEditing(false);
            notifyCapsule(message);
            void refresh(event.id);
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Hapus event?"
          confirmLabel="Hapus event"
          cancelLabel="Kembali"
          onConfirm={async () => {
            try {
              notifyCapsule((await eventApi.remove(token, event.id)).message);
              await onDeleted();
            } catch (caught) {
              notifyCapsule(errorMessage(caught), "error");
            }
          }}
          onClose={() => setDeleting(false)}
        >
          {event.name} dan semua bloknya dihapus permanen
          {held.size > 0 ? `; ${blocks.filter((block) => block.claim).length} blok yang sudah diambil ikut dilepas dan host-nya diberi tahu` : ""}. Event yang
          sudah ada check-in host tidak bisa dihapus.
        </ConfirmDialog>
      )}
    </div>
  );
}

function Summary({
  event,
  blocks,
  days,
  held,
  now,
  onEdit,
  onDelete,
  refresh,
}: {
  event: SpecialEvent;
  blocks: EventBlock[];
  days: string[];
  held: Map<string, number>;
  now: Date;
  onEdit: () => void;
  onDelete: () => void;
  refresh: () => Promise<unknown>;
}) {
  const today = toDateInput(now);
  const claimed = blocks.filter((block) => block.claim).length;
  const open = blocks.filter((block) => statusOf(block, now) === "open").length;
  const running = days.filter((day) => day <= today).length;

  const stats: [string, string | number][] = [
    ["Blok terisi", claimed],
    ["Blok kosong", open],
    ["Host aktif", held.size],
    ["Hari berjalan", `${running}/${days.length}`],
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{event.name}</h2>
          <p className="text-sm text-muted-foreground">
            {event.brand?.name} · setiap hari {event.daily_start_time}–{event.daily_end_time} · blok {formatDuration(event.block_minutes / 60)} · maks{" "}
            {event.max_slots_per_host} blok per host
          </p>
          <p className="text-xs text-muted-foreground">
            {event.open_full_schedule
              ? "Menggantikan jadwal reguler: semua jam di hari-hari ini bisa diambil."
              : "Berjalan bersama jadwal reguler; jam yang sudah terjadwal tidak bisa diambil."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="lg" onClick={onEdit} className={TALL}>
            <Pencil aria-hidden="true" />
            Edit event
          </Button>
          <Button type="button" variant="destructive" size="lg" onClick={onDelete} className={TALL}>
            <Trash2 aria-hidden="true" />
            Hapus
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col-reverse rounded-lg bg-muted/50 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold text-foreground tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <EventSettings key={`${event.max_slots_per_host}-${event.open_full_schedule}`} event={event} refresh={refresh} />
    </Card>
  );
}

/** Quick settings: limit per host and whether the event replaces the regular schedule (the rest is in "Edit event"). */
function EventSettings({ event, refresh }: { event: SpecialEvent; refresh: () => Promise<unknown> }) {
  const { token } = useAuth();
  const [max, setMax] = useState(String(event.max_slots_per_host));
  const [full, setFull] = useState(event.open_full_schedule);
  const [saving, setSaving] = useState(false);
  const maxValue = Number(max);
  const changed = maxValue !== event.max_slots_per_host || full !== event.open_full_schedule;
  const valid = Number.isInteger(maxValue) && maxValue >= 1 && maxValue <= 100;

  async function save() {
    setSaving(true);
    try {
      notifyCapsule((await eventApi.update(token, event.id, { max_slots_per_host: maxValue, open_full_schedule: full })).message);
      await refresh();
    } catch (caught) {
      notifyCapsule(errorMessage(caught), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-border pt-4">
      <label className="space-y-1.5">
        <span className="block text-sm font-medium text-foreground">Maks blok per host</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={max}
          onChange={(change) => setMax(change.target.value)}
          aria-invalid={valid ? undefined : true}
          className={cn(inputClass, TALL, "w-28 tabular-nums")}
        />
      </label>
      <label className="flex h-11 items-center gap-2.5 text-sm text-body">
        <Switch checked={full} onCheckedChange={setFull} />
        Gantikan jadwal reguler
      </label>
      <Button type="button" variant="outline" size="lg" disabled={!changed || !valid || saving} onClick={() => void save()} className={cn(TALL, "sm:ml-auto")}>
        {saving ? "Menyimpan…" : "Simpan pengaturan"}
      </Button>
      {!valid && <p className="w-full text-xs text-destructive">Maks blok per host diisi angka 1 sampai 100.</p>}
    </div>
  );
}

/** Every tile has a border (transparent where there's none) so all are the same size. */
const tileStyle: Record<BlockStatus, string> = {
  taken: "border-transparent bg-primary text-primary-foreground",
  open: "border-primary/45 bg-primary/10 text-brand",
  regular: "border-warning/50 bg-warning/10 text-warning",
  past: "border-transparent bg-muted text-muted-foreground/70",
};

/** The time line above the status, a step quieter than it. */
const timeStyle: Record<BlockStatus, string> = {
  taken: "text-primary-foreground/75",
  open: "text-muted-foreground",
  regular: "text-warning/80",
  past: "text-muted-foreground/60",
};

function Legend() {
  const items: [BlockStatus, string][] = [
    ["taken", "Terisi"],
    ["open", "Kosong"],
    ["regular", "Ada jadwal reguler"],
    ["past", "Sudah lewat, tidak bisa diambil"],
  ];
  return (
    <ul aria-label="Arti warna" className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
      {items.map(([status, label]) => (
        <li key={status} className="flex items-center gap-2">
          <span className={cn("size-3.5 rounded border", tileStyle[status], status === "past" && "border-border")} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

/**
 * One day: header, then its blocks in a grid (2 columns when narrow, more when wide), read
 * left to right, earliest first. Regular and past blocks don't count towards "x/y terisi".
 */
function DayCard({
  day,
  blocks,
  now,
  highlightHost,
  onOpen,
}: {
  day: string;
  blocks: EventBlock[];
  now: Date;
  highlightHost: string | null;
  onOpen: (block: EventBlock) => void;
}) {
  const statuses = blocks.map((block) => statusOf(block, now));
  const counted = statuses.filter((status) => status === "taken" || status === "open").length;
  const filled = statuses.filter((status) => status === "taken").length;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-xs dark:shadow-none">
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-base font-bold text-foreground">{formatDay(`${day}T00:00`)}</h3>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {filled}/{counted} terisi
        </span>
      </header>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5 p-3">
        {blocks.map((block, index) => {
          const status = statuses[index];
          const clickable = status === "open" || status === "taken";
          const mine = Boolean(highlightHost && block.claim?.host_id === highlightHost);
          const label = block.claim ? block.claim.host_name : status === "regular" ? "Jadwal reguler" : status === "past" ? "Lewat" : "Kosong";

          return (
            <li key={block.start_at}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onOpen(block)}
                title={status === "regular" ? (block.reason ?? "Ada jadwal reguler") : block.claim ? block.claim.host_name : undefined}
                aria-label={`${blockTime(block)}, ${label}${clickable ? (block.claim ? ", ganti atau lepas host" : ", tunjuk host") : ""}`}
                className={cn(
                  "flex h-14 w-full flex-col justify-center rounded-lg border px-2.5 text-left transition outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  tileStyle[status],
                  clickable ? "cursor-pointer hover:brightness-95 dark:hover:brightness-110" : "cursor-not-allowed",
                  mine && "ring-[3px] ring-success ring-inset"
                )}
              >
                <span className={cn("text-[11px] leading-tight tabular-nums", timeStyle[status])}>{blockTime(block)}</span>
                <span className="mt-0.5 w-full truncate text-sm leading-tight font-semibold">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Give a block to a host, change who holds it, or take it back. */
function AssignDialog({
  event,
  block,
  hosts,
  hostsLoading,
  held,
  onClose,
  onDone,
}: {
  event: SpecialEvent;
  block: EventBlock;
  hosts: HostLite[];
  hostsLoading: boolean;
  held: Map<string, number>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { token } = useAuth();
  const holder = block.claim;
  const [hostId, setHostId] = useState(holder?.host_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const time = blockTime(block);
  const options: HostLite[] = holder && !hosts.some((host) => host.id === holder.host_id) ? [{ id: holder.host_id, name: holder.host_name }, ...hosts] : hosts;
  const nameOf = (id: string) => options.find((host) => host.id === id)?.name ?? "Host";

  async function run(action: () => Promise<{ message: string }>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      notifyCapsule(message);
      await onDone();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  function save() {
    if (!hostId) return setError("Pilih host dulu.");
    if (hostId === holder?.host_id) return onClose();
    if ((held.get(hostId) ?? 0) >= event.max_slots_per_host) {
      return setError(`${nameOf(hostId)} sudah memegang ${event.max_slots_per_host} blok, batas maksimum per host di event ini.`);
    }
    void run(() => eventApi.assign(token, event.id, block.start_at, hostId), `${nameOf(hostId)} ditunjuk untuk ${time}`);
  }

  return (
    <Dialog
      title="Tunjuk host ke blok"
      description={`${dayOf(block.start_at)} · ${time}`}
      size="md"
      placement="side"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={busy} className={TALL}>
            Tutup
          </Button>
          {holder && (
            <Button
              type="button"
              variant="destructive"
              size="lg"
              disabled={busy}
              onClick={() => void run(() => eventApi.release(token, holder.id), `${holder.host_name} dilepas dari ${time}`)}
              className={TALL}
            >
              Lepas
            </Button>
          )}
          <Button type="button" size="lg" onClick={save} disabled={busy} className={TALL}>
            {busy ? "Menyimpan…" : "Simpan"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-body">
          {holder ? (
            <>
              Dipegang oleh <span className="font-semibold text-foreground">{holder.host_name}</span>.
            </>
          ) : (
            "Belum ada host yang memegang blok ini."
          )}
        </p>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="space-y-1.5">
          <Label htmlFor="assign-host">Host</Label>
          <FilterCombobox
            id="assign-host"
            options={options.map((host) => {
              const count = held.get(host.id) ?? 0;
              const full = count >= event.max_slots_per_host && host.id !== holder?.host_id;
              return { value: host.id, label: host.name, meta: `${count}/${event.max_slots_per_host} blok${full ? " (penuh)" : ""}` };
            })}
            value={hostId || null}
            onChange={(value) => {
              setHostId(value ?? "");
              setError(null);
            }}
            placeholder={hostsLoading ? "Memuat host…" : options.length === 0 ? "Tidak ada host di brand ini" : "Ketik atau pilih host"}
            empty={`Tidak ada host ${event.brand?.name ?? "brand ini"} dengan nama itu.`}
          />
          <p className="text-xs text-muted-foreground">
            Hanya host {event.brand?.name ?? "brand ini"}. Maksimal {event.max_slots_per_host} blok per host di event ini.
          </p>
        </div>
      </div>
    </Dialog>
  );
}

/** Checks before sending, so obvious mistakes show at once next to their field. */
function validate(data: FormData): Record<string, string> {
  const errors: Record<string, string> = {};
  const minutes = Number(formValue(data, "block_hours") || 0) * 60 + Number(formValue(data, "block_extra_minutes") || 0);
  const start = formValue(data, "start_date");
  const end = formValue(data, "end_date");

  if (!formValue(data, "name").trim()) errors.name = "Nama event wajib diisi.";
  if (!Number.isFinite(minutes) || minutes < 15) errors.block_minutes = "Durasi blok minimal 15 menit.";
  else if (minutes > 720) errors.block_minutes = "Durasi blok maksimal 12 jam.";
  if (!start) errors.start_date = "Pilih hari pertama.";
  if (!end) errors.end_date = "Pilih hari terakhir.";
  else if (start && end < start) errors.end_date = "Hari terakhir tidak boleh sebelum hari pertama.";
  if (formValue(data, "daily_start_time") === formValue(data, "daily_end_time")) errors.daily_end_time = "Jam tutup harus beda dengan jam buka.";
  const max = Number(formValue(data, "max_slots_per_host"));
  if (!Number.isInteger(max) || max < 1 || max > 100) errors.max_slots_per_host = "Isi angka 1 sampai 100.";

  return errors;
}

/** New event, or with `event` the edit form: everything but the brand can change. */
function EventForm({ event, onDone, onCancel }: { event?: SpecialEvent; onDone: (message: string, id: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const today = toDateInput();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const [checks, setChecks] = useState<Record<string, string>>({});
  const input = cn(inputClass, TALL, "tabular-nums");

  const { loading, errors: serverErrors, error, handleSubmit } = useApiForm(
    (data) => {
      const payload: Omit<EventInput, "brand_id"> = {
        name: formValue(data, "name").trim(),
        start_date: formValue(data, "start_date"),
        end_date: formValue(data, "end_date"),
        daily_start_time: formValue(data, "daily_start_time"),
        daily_end_time: formValue(data, "daily_end_time"),
        block_minutes: Number(formValue(data, "block_hours") || 0) * 60 + Number(formValue(data, "block_extra_minutes") || 0),
        open_full_schedule: data.get("open_full_schedule") === "on",
        max_slots_per_host: Number(formValue(data, "max_slots_per_host")),
      };
      return event ? eventApi.update(token, event.id, payload) : eventApi.create(token, { ...payload, brand_id: formValue(data, "brand_id") });
    },
    ({ message, event: saved }) => onDone(message, saved.id),
    ["block_minutes"]
  );
  const errors = { ...serverErrors, ...checks };

  function submit(submitted: React.FormEvent<HTMLFormElement>) {
    const found = validate(new FormData(submitted.currentTarget));
    setChecks(found);
    if (Object.keys(found).length > 0) {
      submitted.preventDefault();
      return;
    }
    void handleSubmit(submitted);
  }

  const field = (label: string, name: string, child: React.ReactNode) => (
    <label className="space-y-1.5">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {child}
      {errors[name] && <span className="block text-sm text-destructive">{errors[name]}</span>}
    </label>
  );

  return (
    <Dialog
      placement="side"
      size="lg"
      closeOnOutsideClick={false}
      title={event ? "Edit event" : "Event baru"}
      description={
        event
          ? "Jadwal boleh diubah selama blok yang sudah diambil host tetap ada. Host brand ini diberi tahu kalau tanggal atau jamnya berubah."
          : "Host dari brand ini mengambil blok, siapa cepat dia dapat. Kamu juga bisa menunjuk host langsung."
      }
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onCancel} className={TALL}>
            Batal
          </Button>
          <Button type="submit" form="event-form" size="lg" disabled={loading} className={TALL}>
            {loading ? "Menyimpan…" : event ? "Simpan perubahan" : "Buat event"}
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {(error || errors.schedule) && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{errors.schedule ?? error}</FormAlert>
          </div>
        )}
        {event ? (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground">Brand</span>
            <p className="flex h-11 items-center rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground">{event.brand?.name}</p>
            <span className="block text-xs text-muted-foreground">Brand tidak bisa diubah. Hapus dan buat ulang event kalau salah brand.</span>
          </div>
        ) : (
          field(
            "Brand",
            "brand_id",
            <NativeSelect name="brand_id" className={TALL}>
              {brands.data?.brands
                .filter((brand) => brand.status === "active")
                .map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
            </NativeSelect>
          )
        )}
        {field(
          "Nama",
          "name",
          <input name="name" placeholder="PD 10.10" maxLength={100} defaultValue={event?.name} aria-invalid={errors.name ? true : undefined} className={input} />
        )}
        {field("Hari pertama", "start_date", <DatePicker name="start_date" defaultValue={event?.start_date.slice(0, 10) ?? today} min={event ? undefined : today} />)}
        {field("Hari terakhir", "end_date", <DatePicker name="end_date" defaultValue={event?.end_date.slice(0, 10) ?? today} min={event ? undefined : today} />)}
        {field("Jam buka", "daily_start_time", <input name="daily_start_time" type="time" defaultValue={event?.daily_start_time ?? "10:00"} className={input} />)}
        {field(
          "Jam tutup (boleh lewat tengah malam)",
          "daily_end_time",
          <input
            name="daily_end_time"
            type="time"
            defaultValue={event?.daily_end_time ?? "22:00"}
            aria-invalid={errors.daily_end_time ? true : undefined}
            className={input}
          />
        )}
        {field(
          "Durasi blok",
          "block_minutes",
          <div className="flex items-center gap-2">
            <input name="block_hours" type="number" min={0} max={12} defaultValue={event ? Math.floor(event.block_minutes / 60) : 2} aria-label="Jam per blok" aria-invalid={errors.block_minutes ? true : undefined} className={input} />
            <span className="text-sm text-muted-foreground">jam</span>
            <input name="block_extra_minutes" type="number" min={0} max={59} step={15} defaultValue={event ? event.block_minutes % 60 : 0} aria-label="Menit per blok" aria-invalid={errors.block_minutes ? true : undefined} className={input} />
            <span className="text-sm text-muted-foreground">menit</span>
          </div>
        )}
        {field(
          "Maks blok per host",
          "max_slots_per_host",
          <input name="max_slots_per_host" type="number" min={1} max={100} defaultValue={event?.max_slots_per_host ?? 3} aria-invalid={errors.max_slots_per_host ? true : undefined} className={input} />
        )}
        <label className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-body sm:col-span-2">
          <input type="checkbox" name="open_full_schedule" defaultChecked={event?.open_full_schedule} className="size-4 accent-primary" />
          Gantikan jadwal reguler brand di hari-hari ini <span className="text-muted-foreground">(&quot;jadwal dibuka kosong&quot;)</span>
        </label>
      </form>
    </Dialog>
  );
}
