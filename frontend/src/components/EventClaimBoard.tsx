"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Clock, PartyPopper, Timer } from "lucide-react";
import { errorMessage, eventApi, type EventBlock, type HostEvent } from "@/lib/api";
import { groupByDay } from "@/lib/events";
import { formatDate, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import { CardsSkeleton } from "./Loading";
import StatusBadge, { type Tone } from "./StatusBadge";
import { useToast } from "./Toast";

/** How often the board refreshes while open: others may be grabbing blocks too. */
export const BOARD_REFRESH_MS = 15_000;

/** Fired after I take or give back a block, so every copy of the list (e.g. the menu badge) refreshes. */
const CHANGED = "vidhelp:host-events-changed";

/**
 * Events of my brands and their blocks, for the board and the menu badge. Refreshes
 * every `refreshMs` while the browser tab is visible.
 */
export function useHostEvents(enabled: boolean, refreshMs: number) {
  const { token } = useAuth();
  const events = useApiData(`host-events-${enabled}`, () => (enabled ? eventApi.mine(token) : Promise.resolve({ events: [] as HostEvent[], my_brands: [] as string[] })));
  const { reload } = events;

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => document.visibilityState === "visible" && reload(), refreshMs);
    window.addEventListener(CHANGED, reload);
    return () => {
      clearInterval(timer);
      window.removeEventListener(CHANGED, reload);
    };
  }, [enabled, refreshMs, reload]);

  const claimable = (events.data?.events ?? []).reduce((total, event) => total + claimableBlocks(event).length, 0);

  return { ...events, claimable };
}

/** Free blocks I could still take (none once I hold the maximum). */
function claimableBlocks(event: HostEvent): EventBlock[] {
  return event.my_claims >= event.max_slots_per_host ? [] : event.blocks.filter((block) => block.state === "free");
}

/** "14:00" (local time) */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(".", ":");
}

/** "Sen, 6 Okt" */
function shortDay(date: string): string {
  return new Date(`${date}T00:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
}

/** "2 jam", "90 menit" */
function blockLength(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60} jam` : `${minutes} menit`;
}

type HostEventsState = ReturnType<typeof useHostEvents>;

/**
 * "Rebutan event": first come, first served. Take free blocks of my brands' events
 * (up to each event's limit) or give mine back before they start.
 */
export default function EventClaimBoard({ events }: { events: HostEventsState }) {
  const { token } = useAuth();
  const { show } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<{ event: HostEvent; block: EventBlock } | null>(null);
  const list = events.data?.events ?? [];
  const changed = () => window.dispatchEvent(new Event(CHANGED));

  async function claim(event: HostEvent, block: EventBlock) {
    setPending(block.start_at);
    try {
      const { claim } = await eventApi.claim(token, event.id, block.start_at);
      show({
        text: `Dapat! ${shortDay(toDateInput(new Date(block.start_at)))}, ${clock(block.start_at)}–${clock(block.end_at)} di ${event.name} jadi milikmu.`,
        undo: async () => {
          try {
            await eventApi.cancelClaim(token, claim.id);
            show({ text: "Blok dilepas lagi" });
          } catch (caught) {
            show({ text: errorMessage(caught), tone: "error" });
          }
          changed();
        },
      });
    } catch (caught) {
      show({ text: errorMessage(caught), tone: "error" });
    } finally {
      setPending(null);
      changed();
    }
  }

  async function release() {
    if (!releasing?.block.claim) return;
    const { block } = releasing;
    try {
      await eventApi.cancelClaim(token, block.claim!.id);
      show({ text: `Blok ${clock(block.start_at)}–${clock(block.end_at)} dilepas. Host lain bisa mengambilnya.` });
    } catch (caught) {
      show({ text: errorMessage(caught), tone: "error" });
    }
    setReleasing(null);
    changed();
  }

  return (
    <div className="space-y-6">
      {events.error && <ErrorState message={events.error} onRetry={events.reload} />}
      {!events.data && !events.error && <CardsSkeleton count={2} />}

      {events.data && list.length === 0 && (
        <div className="rounded-xl border border-dashed border-input bg-card/50">
          <EmptyState
            icon={PartyPopper}
            title="Belum ada event untuk brand kamu"
            description={
              events.data.my_brands.length === 0
                ? "Kamu belum ditugaskan ke brand mana pun, jadi belum ada event yang bisa diambil. Minta admin menambahkan kamu ke brand."
                : `Event hanya muncul untuk host di brand event itu. Brand kamu: ${events.data.my_brands.join(", ")}. Kamu akan dapat notifikasi begitu event baru dibuka.`
            }
          />
        </div>
      )}

      {list.map((event) => (
        <EventPanel
          key={event.id}
          event={event}
          pending={pending}
          onClaim={(block) => claim(event, block)}
          onRelease={(block) => setReleasing({ event, block })}
        />
      ))}

      {events.data && list.length > 0 && <p className="text-center text-xs text-faint">Daftar diperbarui otomatis setiap 15 detik.</p>}

      {releasing && (
        <Dialog
          title="Lepas blok ini?"
          size="sm"
          onClose={() => setReleasing(null)}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setReleasing(null)}>
                Batal
              </Button>
              <Button type="button" variant="destructive" onClick={release}>
                Lepas blok
              </Button>
            </>
          }
        >
          <p className="font-medium text-foreground">
            {releasing.event.name}, {shortDay(toDateInput(new Date(releasing.block.start_at)))} {clock(releasing.block.start_at)}–
            {clock(releasing.block.end_at)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">Host lain bisa langsung mengambilnya, dan belum tentu bisa kamu ambil lagi.</p>
        </Dialog>
      )}
    </div>
  );
}

function EventPanel({
  event,
  pending,
  onClaim,
  onRelease,
}: {
  event: HostEvent;
  pending: string | null;
  onClaim: (block: EventBlock) => void;
  onRelease: (block: EventBlock) => void;
}) {
  const days = groupByDay(event.blocks);
  const full = event.my_claims >= event.max_slots_per_host;
  const free = event.blocks.filter((block) => block.state === "free").length;
  const taken = event.blocks.filter((block) => block.state === "taken" || block.state === "mine").length;
  // Open on the first day that still has something to take, else the first that isn't over
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const day =
    chosenDay ??
    days.find(([, blocks]) => blocks.some((block) => block.state === "free"))?.[0] ??
    days.find(([, blocks]) => blocks.some((block) => block.state !== "past"))?.[0] ??
    days[0]?.[0];
  const blocks = days.find(([date]) => date === day)?.[1] ?? [];
  const share = Math.min(100, (event.my_claims / Math.max(1, event.max_slots_per_host)) * 100);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
      {/* What the event is */}
      <div className="space-y-4 border-b border-border p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">{event.name}</h2>
              <StatusBadge tone="neutral">{event.brand?.name}</StatusBadge>
              {event.open_full_schedule && <StatusBadge tone="warning">Menggantikan jadwal reguler</StatusBadge>}
            </div>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <dt>
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Tanggal</span>
                </dt>
                <dd>
                  {formatDate(event.start_date)}
                  {event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ""}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>
                  <Clock className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Jam</span>
                </dt>
                <dd className="tabular-nums">
                  {event.daily_start_time}–{event.daily_end_time}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>
                  <Timer className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Panjang blok</span>
                </dt>
                <dd>Blok {blockLength(event.block_minutes)}</dd>
              </div>
            </dl>
          </div>
          <StatusBadge tone={free > 0 ? "brand" : "neutral"} className="h-7 px-2.5">
            {free > 0 ? `${free} blok tersisa` : "Semua terisi"}
          </StatusBadge>
        </div>

        {/* My share of this event */}
        <div className="space-y-1.5">
          <div className="flex justify-between gap-3 text-xs">
            <span className="text-body">
              Blokmu <span className="font-semibold text-foreground tabular-nums">{event.my_claims}</span> dari {event.max_slots_per_host}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {taken}/{event.blocks.length} blok sudah diambil
            </span>
          </div>
          <Progress value={share} aria-label="Kuota blokmu" className="h-1.5" indicatorClassName={full ? "bg-success" : undefined} />
          {full && <p className="text-xs text-success">Kuota kamu penuh. Lepas satu blok kalau ingin mengambil yang lain.</p>}
        </div>

        {days.length > 1 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]" role="tablist" aria-label="Hari event">
            {days.map(([date, dayBlocks]) => {
              const open = dayBlocks.filter((block) => block.state === "free").length;
              const mine = dayBlocks.some((block) => block.state === "mine");
              const selected = date === day;
              return (
                <button
                  key={date}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setChosenDay(date)}
                  className={cn(
                    "shrink-0 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                  )}
                >
                  <span className={cn("block text-xs font-semibold", selected ? "text-brand" : "text-foreground")}>{shortDay(date)}</span>
                  <span className={cn("flex items-center gap-1 text-[11px]", mine ? "text-success" : open > 0 ? "text-brand" : "text-faint")}>
                    {mine && <Check className="size-3" aria-hidden="true" />}
                    {mine ? "ada blokmu" : open > 0 ? `${open} kosong` : "penuh"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* The blocks of the chosen day */}
      <ul className="grid gap-2 p-4 sm:grid-cols-2 md:p-5 xl:grid-cols-3 2xl:grid-cols-4" aria-label={`Blok ${day ? shortDay(day) : ""}`}>
        {blocks.map((block) => (
          <BlockTile
            key={block.start_at}
            block={block}
            minutes={event.block_minutes}
            full={full}
            pending={pending === block.start_at}
            busy={pending !== null}
            onClaim={() => onClaim(block)}
            onRelease={() => onRelease(block)}
          />
        ))}
      </ul>
    </section>
  );
}

const stateTones: Record<EventBlock["state"], Tone> = {
  free: "brand",
  mine: "success",
  taken: "neutral",
  busy: "warning",
  unavailable: "neutral",
  past: "neutral",
};

function BlockTile({
  block,
  minutes,
  full,
  pending,
  busy,
  onClaim,
  onRelease,
}: {
  block: EventBlock;
  minutes: number;
  full: boolean;
  pending: boolean;
  busy: boolean;
  onClaim: () => void;
  onRelease: () => void;
}) {
  const status: Record<EventBlock["state"], string> = {
    free: "Kosong",
    mine: "Punyamu",
    taken: `Diambil ${block.claim?.host_name ?? "host lain"}`,
    busy: "Bentrok dengan jadwalmu",
    unavailable: "Ada jadwal reguler",
    past: "Sudah lewat",
  };
  const canRelease = block.state === "mine" && Boolean(block.claim) && new Date(block.start_at) > new Date();

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors",
        block.state === "free" ? "border-primary/30 bg-primary/[0.03]" : block.state === "mine" ? "border-success/40 bg-success/[0.06]" : "border-border",
        block.state === "past" && "opacity-55"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground tabular-nums">
          {clock(block.start_at)}–{clock(block.end_at)}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{blockLength(minutes)}</span>
        </p>
        <StatusBadge tone={stateTones[block.state]} title={block.reason ?? undefined} className="mt-1 h-5 max-w-full px-1.5 text-[11px]">
          {block.state === "mine" && <Check className="size-3" aria-hidden="true" />}
          <span className="truncate">{status[block.state]}</span>
        </StatusBadge>
      </div>
      {block.state === "free" && (
        <Button
          type="button"
          size="sm"
          onClick={onClaim}
          disabled={full || busy}
          title={full ? "Kuota kamu untuk event ini sudah penuh" : undefined}
          className="min-w-20 active:scale-[0.97]"
        >
          {pending ? "Mengambil…" : "Ambil"}
        </Button>
      )}
      {canRelease && (
        <Button type="button" size="sm" variant="outline" onClick={onRelease} className="min-w-20 text-destructive hover:text-destructive">
          Lepas
        </Button>
      )}
    </li>
  );
}
