"use client";

import { useEffect, useState } from "react";
import { errorMessage, eventApi, type EventBlock, type HostEvent } from "@/lib/api";
import { groupByDay } from "@/lib/events";
import { formatDate, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import FormAlert from "./FormAlert";
import Toast, { useToast } from "./Toast";

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
  const { toast, show, dismiss } = useToast();
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
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-400">
          Siapa cepat dia dapat. Ambil blok live event dari brand kamu; tiap event punya batas blok per host.
        </p>
        <button
          type="button"
          onClick={events.reload}
          disabled={events.loading}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-60"
        >
          {events.loading ? "Memuat…" : "↻ Segarkan"}
        </button>
      </div>

      {events.error && <FormAlert tone="error">{events.error}</FormAlert>}

      {events.data && list.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center">
          <p className="text-3xl" aria-hidden="true">
            🎪
          </p>
          <p className="mt-2 text-white font-medium">Belum ada event untuk brand kamu</p>
          <p className="mt-1 text-sm text-gray-400">
            {events.data.my_brands.length === 0
              ? "Kamu belum ditugaskan ke brand mana pun, jadi belum ada event yang bisa diambil. Minta Admin menambahkan kamu ke brand."
              : `Event hanya muncul untuk host di brand event itu. Brand kamu: ${events.data.my_brands.join(", ")}. Kamu akan dapat notifikasi begitu event baru dibuka.`}
          </p>
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

      {events.data && list.length > 0 && <p className="text-center text-xs text-gray-500">Daftar diperbarui otomatis setiap 15 detik.</p>}

      {releasing && (
        <Dialog
          title="Lepas blok ini?"
          onClose={() => setReleasing(null)}
          footer={
            <>
              <button type="button" onClick={() => setReleasing(null)} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-slate-800">
                Batal
              </button>
              <span className="flex-1" />
              <button type="button" onClick={release} className="px-5 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500">
                Lepas blok
              </button>
            </>
          }
        >
          <p className="text-gray-100">
            {releasing.event.name}, {shortDay(toDateInput(new Date(releasing.block.start_at)))} {clock(releasing.block.start_at)}–
            {clock(releasing.block.end_at)}.
          </p>
          <p className="mt-2 text-sm text-gray-400">Host lain bisa langsung mengambilnya, dan belum tentu bisa kamu ambil lagi.</p>
        </Dialog>
      )}

      <Toast toast={toast} onDismiss={dismiss} />
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

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
      {/* What the event is */}
      <div className="p-4 space-y-3 border-b border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-white font-semibold truncate">{event.name}</h2>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-gray-300">{event.brand?.name}</span>
              {event.open_full_schedule && (
                <span className="rounded-md bg-yellow-400/15 px-2 py-0.5 text-[11px] text-yellow-200">Menggantikan jadwal reguler</span>
              )}
            </div>
            <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
              <div>
                <dt className="sr-only">Tanggal</dt>
                <dd>
                  📅 {formatDate(event.start_date)}
                  {event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="sr-only">Jam</dt>
                <dd>
                  🕒 {event.daily_start_time}–{event.daily_end_time}
                </dd>
              </div>
              <div>
                <dt className="sr-only">Panjang blok</dt>
                <dd>⏱ Blok {blockLength(event.block_minutes)}</dd>
              </div>
            </dl>
          </div>
          <span
            className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${free > 0 ? "bg-purple-500/15 text-purple-200" : "bg-slate-800 text-gray-400"}`}
          >
            {free > 0 ? `${free} blok tersisa` : "Semua terisi"}
          </span>
        </div>

        {/* My share of this event */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-gray-300">
              Blokmu: <span className="font-medium text-white">{event.my_claims}</span> dari {event.max_slots_per_host}
            </span>
            <span className="text-gray-500">
              {taken}/{event.blocks.length} blok sudah diambil
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${full ? "bg-green-400" : "bg-purple-500"}`}
              style={{ width: `${Math.min(100, (event.my_claims / Math.max(1, event.max_slots_per_host)) * 100)}%` }}
            />
          </div>
          {full && <p className="text-xs text-green-300">Kuota kamu penuh. Lepas satu blok kalau ingin mengambil yang lain.</p>}
        </div>

        {days.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Hari event">
            {days.map(([date, dayBlocks]) => {
              const open = dayBlocks.filter((block) => block.state === "free").length;
              const mine = dayBlocks.some((block) => block.state === "mine");
              return (
                <button
                  key={date}
                  type="button"
                  role="tab"
                  aria-selected={date === day}
                  onClick={() => setChosenDay(date)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-left ${
                    date === day ? "bg-purple-600 border-purple-500 text-white" : "border-slate-700 text-gray-300 hover:bg-slate-800"
                  }`}
                >
                  <span className="block text-xs font-medium">{shortDay(date)}</span>
                  <span className={`block text-[11px] ${date === day ? "text-purple-100" : open > 0 ? "text-purple-300" : "text-gray-500"}`}>
                    {mine ? "✓ ada blokmu" : open > 0 ? `${open} kosong` : "penuh"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* The blocks of the chosen day */}
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">Blok {day ? shortDay(day) : ""}</caption>
        <thead>
          <tr className="bg-slate-950/40 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <th scope="col" className="w-32 sm:w-40 px-4 py-2 font-medium">
              Jam
            </th>
            <th scope="col" className="hidden sm:table-cell w-28 px-2 py-2 font-medium">
              Durasi
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="w-28 sm:w-32 px-4 py-2 font-medium text-right">
              Aksi
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {blocks.map((block) => (
            <BlockRow
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
        </tbody>
      </table>
    </section>
  );
}

const statusStyles: Record<EventBlock["state"], string> = {
  free: "bg-purple-500/15 text-purple-200",
  mine: "bg-green-500/15 text-green-300",
  taken: "bg-slate-800 text-gray-300",
  busy: "bg-amber-500/10 text-amber-200",
  unavailable: "bg-slate-800 text-gray-400",
  past: "bg-slate-800/60 text-gray-500",
};

function BlockRow({
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
    mine: "✓ Punyamu",
    taken: `Diambil ${block.claim?.host_name ?? "host lain"}`,
    busy: "Bentrok dengan jadwalmu",
    unavailable: "Ada jadwal reguler",
    past: "Sudah lewat",
  };
  const canRelease = block.state === "mine" && Boolean(block.claim) && new Date(block.start_at) > new Date();

  return (
    <tr className={`${block.state === "mine" ? "bg-green-500/5" : ""} ${block.state === "past" ? "opacity-50" : ""}`}>
      <td className="px-4 py-2.5 whitespace-nowrap font-medium tabular-nums text-white">
        {clock(block.start_at)}–{clock(block.end_at)}
      </td>
      <td className="hidden sm:table-cell px-2 py-2.5 whitespace-nowrap text-gray-400">{blockLength(minutes)}</td>
      <td className="px-2 py-2.5">
        <span
          title={block.reason ?? undefined}
          className={`inline-block max-w-full truncate rounded-md px-2 py-0.5 text-xs align-middle ${statusStyles[block.state]}`}
        >
          {status[block.state]}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        {block.state === "free" && (
          <button
            type="button"
            onClick={onClaim}
            disabled={full || busy}
            title={full ? "Kuota kamu untuk event ini sudah penuh" : undefined}
            className="min-w-20 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 active:scale-[0.97] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Mengambil…" : "Ambil"}
          </button>
        )}
        {canRelease && (
          <button
            type="button"
            onClick={onRelease}
            className="min-w-20 rounded-lg border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10"
          >
            Lepas
          </button>
        )}
        {block.state !== "free" && !canRelease && <span className="text-gray-600">—</span>}
      </td>
    </tr>
  );
}
