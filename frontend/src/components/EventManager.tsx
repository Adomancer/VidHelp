"use client";

import { useState } from "react";
import { errorMessage, eventApi, operatorApi, scheduleApi, type BrandHost, type EventBlock, type EventInput, type EventListItem } from "@/lib/api";
import { groupByDay } from "@/lib/events";
import { formatClock, formatDate, formatDay, formatDuration, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
import Modal from "./Modal";
import SubmitButton from "./SubmitButton";

type Notice = { tone: "success" | "error"; text: string } | null;

/**
 * Admin/operator: create special events and manage who holds each block.
 */
export default function EventManager() {
  const { token } = useAuth();
  const events = useApiData("events", () => eventApi.list(token));
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const active = events.data?.events ?? [];
  const eventId = selected ?? active.find((event) => event.status === "active")?.id ?? null;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setCreating(true)} className="px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary-hover">
          Event baru
        </button>
      </div>

      {creating && (
        <EventForm
          onDone={(message, id) => {
            setCreating(false);
            setNotice({ tone: "success", text: message });
            setSelected(id);
            events.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {events.error && <FormAlert tone="error">{events.error}</FormAlert>}

      {events.data && active.length === 0 && (
        <Card>
          <p className="text-sm text-muted">Belum ada event. Buat event untuk kampanye PD atau double date.</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <ul className="space-y-2">
          {active.map((event) => (
            <li key={event.id}>
              <EventListButton event={event} selected={event.id === eventId} onClick={() => setSelected(event.id)} />
            </li>
          ))}
        </ul>
        {eventId && (
          <EventDetail
            key={eventId}
            eventId={eventId}
            onChanged={(text, tone = "success") => {
              setNotice({ tone, text });
              events.reload();
            }}
          />
        )}
      </div>
    </div>
  );
}

function EventListButton({ event, selected, onClick }: { event: EventListItem; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg px-3 py-2 border ${selected ? "bg-primary/20 border-primary/50" : "bg-surface border-stroke hover:bg-surface-2"}`}
    >
      <p className={`text-sm font-medium ${event.status === "cancelled" ? "text-faint line-through" : "text-heading"}`}>{event.name}</p>
      <p className="text-xs text-muted">
        {event.brand?.name} · {formatDate(event.start_date)}
        {event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ""}
      </p>
      <p className="text-xs text-faint">
        {event.status === "cancelled" ? "dibatalkan" : `${event.claimed_blocks}/${event.total_blocks} blok terisi`}
      </p>
    </button>
  );
}

function EventDetail({ eventId, onChanged }: { eventId: string; onChanged: (text: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`event-${eventId}`, () => eventApi.show(token, eventId));
  const brandId = detail.data?.event.brand_id ?? "";
  const hosts = useApiData(`event-hosts-${brandId}`, () => (brandId ? scheduleApi.brandHosts(token, brandId) : Promise.resolve({ assignments: [] })));
  const [openDay, setOpenDay] = useState<string | null>(null);

  async function act(action: () => Promise<{ message: string }>) {
    try {
      onChanged((await action()).message);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
    detail.reload();
  }

  if (detail.error) return <FormAlert tone="error">{detail.error}</FormAlert>;
  if (!detail.data) return <p className="text-muted">Memuat…</p>;
  const { event, blocks } = detail.data;
  const cancelled = event.status === "cancelled";
  const days = groupByDay(blocks);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg text-heading font-medium">{event.name}</p>
            <p className="text-sm text-muted">
              {event.brand?.name} · setiap hari {event.daily_start_time}–{event.daily_end_time} · blok {formatDuration(event.block_minutes / 60)} · maks{" "}
              {event.max_slots_per_host} per host
            </p>
            <p className="text-xs text-muted mt-1">
              {event.open_full_schedule ? "Menggantikan jadwal reguler di hari-hari ini." : "Berjalan bersama jadwal reguler; jam yang sudah terjadwal tidak bisa diambil."}
            </p>
          </div>
          {!cancelled && (
            <button
              type="button"
              onClick={() => confirm(`Batalkan ${event.name}? Semua blok yang sudah diambil akan dilepas.`) && act(() => eventApi.cancel(token, event.id))}
              className="px-3 py-1.5 rounded-lg border border-red-400/40 text-danger text-sm hover:bg-red-500/10"
            >
              Batalkan event
            </button>
          )}
        </div>
        {!cancelled && <EventSettings key={`${event.max_slots_per_host}-${event.open_full_schedule}`} eventId={event.id} maxPerHost={event.max_slots_per_host} openFull={event.open_full_schedule} act={act} />}
      </Card>

      <Card title="Blok per hari" description="Klik hari untuk melihat setiap blok dan mengatur host-nya.">
        <ul className="-my-2 divide-y divide-stroke">
          {days.map(([day, dayBlocks]) => (
            <li key={day}>
              <DaySummary day={day} blocks={dayBlocks} onOpen={() => setOpenDay(day)} />
            </li>
          ))}
        </ul>
        <BlockLegend />
      </Card>

      {openDay && (
        <DayBlocksModal
          day={openDay}
          eventName={event.name}
          eventId={event.id}
          blocks={days.find(([day]) => day === openDay)?.[1] ?? []}
          hosts={hosts.data?.assignments ?? []}
          editable={!cancelled}
          act={act}
          onClose={() => setOpenDay(null)}
        />
      )}
    </div>
  );
}

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

/** Strip colors, one segment per block: who has it at a glance. */
function blockColor(block: EventBlock): string {
  if (block.claim) return "bg-primary";
  if (block.state === "unavailable") return "bg-amber-400/60";
  if (block.state === "past") return "bg-stroke";
  return "bg-primary/15 ring-1 ring-inset ring-primary/40";
}

/** One day of the event in a line: a strip of its blocks, how many are taken and by whom. */
function DaySummary({ day, blocks, onOpen }: { day: string; blocks: EventBlock[]; onOpen: () => void }) {
  const claimed = blocks.filter((block) => block.claim).length;
  const open = blocks.filter((block) => !block.claim && block.state === "free").length;
  const holders = [...new Set(blocks.flatMap((block) => (block.claim ? [block.claim.host_name] : [])))];

  return (
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-4 rounded-lg px-1 py-3 text-left hover:bg-surface-2">
      <span className="w-28 shrink-0">
        <span className="block text-sm font-medium text-heading">{formatDay(`${day}T00:00`)}</span>
        <span className="block text-xs text-muted">
          {claimed}/{blocks.length} terisi
        </span>
      </span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex gap-0.5" aria-hidden="true">
          {blocks.map((block) => (
            <span key={block.start_at} className={`h-2.5 flex-1 rounded-sm ${blockColor(block)}`} />
          ))}
        </span>
        <span className="block truncate text-xs text-muted">
          {holders.length > 0
            ? `Diambil ${holders.slice(0, 3).join(", ")}${holders.length > 3 ? ` +${holders.length - 3} lainnya` : ""}`
            : "Belum ada yang mengambil"}
          {open > 0 && <span className="text-accent"> · {open} masih kosong</span>}
        </span>
      </span>
      <span className="shrink-0 text-sm text-muted group-hover:text-heading">Detail ›</span>
    </button>
  );
}

function BlockLegend() {
  const items: [string, string][] = [
    ["bg-primary", "Terisi"],
    ["bg-primary/15 ring-1 ring-inset ring-primary/40", "Kosong"],
    ["bg-amber-400/60", "Ada jadwal reguler"],
    ["bg-stroke", "Lewat, tidak diambil"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-stroke pt-3 text-xs text-muted">
      {items.map(([color, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-4 rounded-sm ${color}`} /> {label}
        </span>
      ))}
    </div>
  );
}

/** Every block of one day, with who holds it; give, change or release a block from the row. */
function DayBlocksModal({
  day,
  eventName,
  eventId,
  blocks,
  hosts,
  editable,
  act,
  onClose,
}: {
  day: string;
  eventName: string;
  eventId: string;
  blocks: EventBlock[];
  hosts: BrandHost[];
  editable: boolean;
  act: Act;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignHostId, setAssignHostId] = useState("");
  const claimed = blocks.filter((block) => block.claim).length;

  async function run(action: () => Promise<{ message: string }>) {
    await act(action);
    setAssigning(null);
  }

  return (
    <Modal title={formatDay(`${day}T00:00`)} description={`${eventName} · ${claimed}/${blocks.length} blok terisi`} onClose={onClose} wide>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-faint">
            <th className="w-32 pb-2 font-medium">Jam</th>
            <th className="pb-2 font-medium">Host / status</th>
            <th className="pb-2 text-right font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stroke">
          {blocks.map((block) => {
            const upcoming = new Date(block.end_at) > new Date();
            return (
              <tr key={block.start_at} className={block.state === "past" && !block.claim ? "opacity-60" : ""}>
                <td className="py-2.5 whitespace-nowrap tabular-nums text-accent">
                  {formatClock(block.start_at)}–{formatClock(block.end_at)}
                </td>
                <td className="py-2.5">
                  {block.claim ? (
                    <span className="font-medium text-heading">{block.claim.host_name}</span>
                  ) : block.state === "unavailable" ? (
                    <span className="text-faint">{block.reason}</span>
                  ) : (
                    <span className="text-muted">{block.state === "past" ? "Tidak diambil" : "Kosong"}</span>
                  )}
                  {assigning === block.start_at && (
                    <div className="mt-2 flex gap-2">
                      <select
                        value={assignHostId || hosts[0]?.host_id || ""}
                        onChange={(change) => setAssignHostId(change.target.value)}
                        aria-label="Host"
                        className="flex-1 rounded-md border border-stroke-strong bg-surface px-2 py-1.5 text-sm text-heading"
                      >
                        {hosts.map((assignment) => (
                          <option key={assignment.host_id} value={assignment.host_id}>
                            {assignment.host.user.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const hostId = assignHostId || hosts[0]?.host_id;
                          if (hostId) run(() => eventApi.assign(token, eventId, block.start_at, hostId));
                        }}
                        className="rounded-md bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary-hover"
                      >
                        Berikan blok
                      </button>
                    </div>
                  )}
                </td>
                <td className="py-2.5 text-right whitespace-nowrap align-top">
                  {editable && upcoming ? (
                    <span className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAssigning(assigning === block.start_at ? null : block.start_at)}
                        className="rounded-md border border-stroke-strong px-2.5 py-1 text-xs text-body hover:bg-surface-2"
                      >
                        {assigning === block.start_at ? "Tutup" : block.claim ? "Ganti host" : "Tunjuk host"}
                      </button>
                      {block.claim && (
                        <button
                          type="button"
                          onClick={() => run(() => eventApi.release(token, block.claim!.id))}
                          className="rounded-md border border-red-400/40 px-2.5 py-1 text-xs text-danger hover:bg-red-500/10"
                        >
                          Lepas
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

function EventSettings({
  eventId,
  maxPerHost,
  openFull,
  act,
}: {
  eventId: string;
  maxPerHost: number;
  openFull: boolean;
  act: (action: () => Promise<{ message: string }>) => Promise<void>;
}) {
  const { token } = useAuth();
  const [max, setMax] = useState(String(maxPerHost));
  const [full, setFull] = useState(openFull);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-stroke pt-3 text-sm">
      <label className="flex items-center gap-2 text-body">
        Maks blok per host
        <input type="number" min={1} max={100} value={max} onChange={(event) => setMax(event.target.value)} className="w-16 px-2 py-1 rounded-md bg-surface-2 border border-stroke-strong text-heading" />
      </label>
      <label className="flex items-center gap-2 text-body">
        <input type="checkbox" checked={full} onChange={(event) => setFull(event.target.checked)} className="accent-primary" />
        Gantikan jadwal reguler
      </label>
      <button
        type="button"
        onClick={() => act(() => eventApi.update(token, eventId, { max_slots_per_host: Number(max), open_full_schedule: full }))}
        className="px-3 py-1 rounded-md border border-stroke-strong text-body hover:bg-surface-2"
      >
        Simpan
      </button>
    </div>
  );
}

function EventForm({ onDone, onCancel }: { onDone: (message: string, id: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const input = "w-full px-3 py-2 rounded-lg bg-surface-2 border border-stroke-strong text-heading";

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => {
      const payload: EventInput = {
        brand_id: formValue(data, "brand_id"),
        name: formValue(data, "name"),
        start_date: formValue(data, "start_date"),
        end_date: formValue(data, "end_date"),
        daily_start_time: formValue(data, "daily_start_time"),
        daily_end_time: formValue(data, "daily_end_time"),
        block_minutes: Number(formValue(data, "block_hours")) * 60 + Number(formValue(data, "block_extra_minutes") || 0),
        open_full_schedule: data.get("open_full_schedule") === "on",
        max_slots_per_host: Number(formValue(data, "max_slots_per_host")),
      };
      return eventApi.create(token, payload);
    },
    ({ message, event }) => onDone(message, event.id)
  );

  const field = (label: string, name: string, child: React.ReactNode) => (
    <label className="space-y-1">
      <span className="block text-xs text-muted">{label}</span>
      {child}
      {errors[name] && <span className="block text-xs text-danger">{errors[name]}</span>}
    </label>
  );

  return (
    <Modal title="Event baru" description="Host dari brand ini mengambil blok, siapa cepat dia dapat." onClose={onCancel} wide>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        {field(
          "Brand",
          "brand_id",
          <select name="brand_id" className={input}>
            {brands.data?.brands
              .filter((brand) => brand.status === "active")
              .map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
          </select>
        )}
        {field("Nama", "name", <input name="name" placeholder="PD 10.10" maxLength={100} className={input} />)}
        {field("Hari pertama", "start_date", <input name="start_date" type="date" defaultValue={toDateInput()} min={toDateInput()} className={input} />)}
        {field("Hari terakhir", "end_date", <input name="end_date" type="date" defaultValue={toDateInput()} min={toDateInput()} className={input} />)}
        {field("Buka setiap hari jam", "daily_start_time", <input name="daily_start_time" type="time" defaultValue="10:00" className={input} />)}
        {field("Tutup jam (boleh lewat tengah malam)", "daily_end_time", <input name="daily_end_time" type="time" defaultValue="22:00" className={input} />)}
        {field(
          "Durasi blok",
          "block_minutes",
          <div className="flex items-center gap-2">
            <input name="block_hours" type="number" min={0} max={12} defaultValue={2} aria-label="Jam per blok" className={input} />
            <span className="text-sm text-muted">jam</span>
            <input name="block_extra_minutes" type="number" min={0} max={59} step={15} defaultValue={0} aria-label="Menit per blok" className={input} />
            <span className="text-sm text-muted">menit</span>
          </div>
        )}
        {field("Maks blok per host", "max_slots_per_host", <input name="max_slots_per_host" type="number" min={1} max={100} defaultValue={3} className={input} />)}
        <label className="flex items-center gap-2 text-sm text-body sm:col-span-2">
          <input type="checkbox" name="open_full_schedule" className="accent-primary" />
          Gantikan jadwal reguler brand di hari-hari ini (&quot;jadwal dibuka kosong&quot;)
        </label>
        <div className="sm:col-span-2 flex gap-3">
          <div className="w-40">
            <SubmitButton loading={loading}>Buat event</SubmitButton>
          </div>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-body hover:bg-surface-2">
            Batal
          </button>
        </div>
      </form>
    </Modal>
  );
}
