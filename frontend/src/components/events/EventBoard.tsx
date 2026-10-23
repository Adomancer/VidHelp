"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { errorMessage, eventApi, scheduleApi, type EventBlock, type EventListItem, type SpecialEvent } from "@/lib/api";
import { groupByDay } from "@/lib/events";
import { appDate, formatDay, formatDuration } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useNow } from "@/lib/useNow";
import { inputClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "../AuthProvider";
import Card from "../Card";
import ConfirmDialog from "../ConfirmDialog";
import ErrorState from "../ErrorState";
import { CardsSkeleton } from "../Loading";
import { notifyCapsule } from "../Toast";
import { AssignDialog } from "./AssignDialog";
import { EventForm } from "./EventForm";
import { activeHosts, type BlockStatus, blockTime, statusOf, TALL } from "./shared";

/** The chosen event: summary, settings, legend, and a card per day. */
export function EventBoard({
  listed,
  highlightHost,
  refresh,
  onDeleted,
}: {
  listed: EventListItem;
  highlightHost: string | null;
  refresh: (id: string) => Promise<unknown>;
  onDeleted: () => Promise<void>;
}) {
  // Block states follow the clock on the open event only, not the whole page
  const now = useNow(30_000);
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
      <Summary
        event={event}
        blocks={blocks}
        days={days.map(([day]) => day)}
        held={held}
        now={now}
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleting(true)}
        refresh={() => refresh(event.id)}
      />

      <Legend />

      {/* Days side by side, earliest on the left: they share the width when few, scroll sideways (snapping to a card's edge) when many */}
      <ul aria-label="Hari event" className="flex snap-x snap-mandatory [scrollbar-width:thin] items-start gap-4 overflow-x-auto pb-3">
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
  const today = appDate(now);
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
