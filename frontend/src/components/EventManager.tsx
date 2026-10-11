"use client";

import { useState } from "react";
import { ChevronRight, Plus, Ticket } from "lucide-react";
import { errorMessage, eventApi, operatorApi, scheduleApi, type BrandHost, type EventBlock, type EventInput, type EventListItem } from "@/lib/api";
import { groupByDay } from "@/lib/events";
import { formatClock, formatDate, formatDay, formatDuration, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useMediaQuery } from "@/hooks/use-mobile";
import { inputClass, inputSmClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import ConfirmDialog from "./ConfirmDialog";
import Dialog from "./Dialog";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import FormActions from "./FormActions";
import FormAlert from "./FormAlert";
import { CardsSkeleton } from "./Loading";
import Modal from "./Modal";
import { NativeSelect } from "./SelectField";
import StatusBadge from "./StatusBadge";
import { notify } from "./Toast";

/**
 * Admin/operator: create special events and manage who holds each block.
 */
export default function EventManager() {
  const { token } = useAuth();
  const events = useApiData("events", () => eventApi.list(token));
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1024px)");

  const active = events.data?.events ?? [];
  const eventId = selected ?? (wide ? active.find((event) => event.status === "active")?.id : null) ?? null;

  const detail = eventId && (
    <EventDetail
      key={eventId}
      eventId={eventId}
      onChanged={(text, tone = "success") => {
        if (tone === "success") notify({ text });
        else setError(text);
        events.reload();
      }}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          Event baru
        </Button>
      </div>

      {creating && (
        <EventForm
          onDone={(message, id) => {
            setCreating(false);
            notify({ text: message });
            setSelected(id);
            events.reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {events.error && <ErrorState message={events.error} onRetry={events.reload} />}
      {!events.data && !events.error && <CardsSkeleton count={2} />}

      {events.data && active.length === 0 && (
        <Card>
          <EmptyState
            icon={Ticket}
            title="Belum ada event"
            description="Buat event untuk kampanye PD atau double date. Host dari brand-nya bisa langsung mengambil blok."
            action={
              <Button type="button" variant="outline" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" />
                Event baru
              </Button>
            }
          />
        </Card>
      )}

      {active.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
          <ul className="space-y-2 lg:sticky lg:top-20">
            {active.map((event) => (
              <li key={event.id}>
                <EventListButton event={event} selected={event.id === eventId} onClick={() => setSelected(event.id)} />
              </li>
            ))}
          </ul>
          {wide ? (
            detail || <CardsSkeleton count={2} />
          ) : (
            eventId && (
              <Dialog title="Detail event" placement="side" size="lg" onClose={() => setSelected(null)}>
                {detail}
              </Dialog>
            )
          )}
        </div>
      )}
    </div>
  );
}

function EventListButton({ event, selected, onClick }: { event: EventListItem; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full space-y-1.5 rounded-xl border px-3.5 py-3 text-left shadow-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:shadow-none",
        selected ? "border-primary/50 bg-primary/[0.06]" : "border-border bg-card hover:bg-muted/60"
      )}
    >
      <p className={cn("text-sm font-semibold", event.status === "cancelled" ? "text-faint line-through" : "text-foreground")}>{event.name}</p>
      <p className="text-xs text-muted-foreground">
        {event.brand?.name} · {formatDate(event.start_date)}
        {event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ""}
      </p>
      {event.status === "cancelled" ? (
        <StatusBadge tone="neutral" className="h-5 px-1.5 text-[11px]">
          Dibatalkan
        </StatusBadge>
      ) : (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${event.total_blocks > 0 ? (event.claimed_blocks / event.total_blocks) * 100 : 0}%` }} />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {event.claimed_blocks}/{event.total_blocks}
          </span>
        </div>
      )}
    </button>
  );
}

function EventDetail({ eventId, onChanged }: { eventId: string; onChanged: (text: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`event-${eventId}`, () => eventApi.show(token, eventId));
  const brandId = detail.data?.event.brand_id ?? "";
  const hosts = useApiData(`event-hosts-${brandId}`, () => (brandId ? scheduleApi.brandHosts(token, brandId) : Promise.resolve({ assignments: [] })));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function act(action: () => Promise<{ message: string }>) {
    try {
      onChanged((await action()).message);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
    detail.reload();
  }

  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <CardsSkeleton count={2} />;
  const { event, blocks } = detail.data;
  const cancelled = event.status === "cancelled";
  const days = groupByDay(blocks);

  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight text-foreground">{event.name}</p>
            <p className="text-sm text-muted-foreground">
              {event.brand?.name} · setiap hari {event.daily_start_time}–{event.daily_end_time} · blok {formatDuration(event.block_minutes / 60)} · maks{" "}
              {event.max_slots_per_host} per host
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {event.open_full_schedule ? "Menggantikan jadwal reguler di hari-hari ini." : "Berjalan bersama jadwal reguler; jam yang sudah terjadwal tidak bisa diambil."}
            </p>
          </div>
          {!cancelled && (
            <Button type="button" variant="outline" size="sm" onClick={() => setCancelling(true)} className="text-destructive hover:text-destructive">
              Batalkan event
            </Button>
          )}
        </div>
        {!cancelled && <EventSettings key={`${event.max_slots_per_host}-${event.open_full_schedule}`} eventId={event.id} maxPerHost={event.max_slots_per_host} openFull={event.open_full_schedule} act={act} />}
      </Card>

      <Card title="Blok per hari" description="Klik hari untuk melihat setiap blok dan mengatur host-nya.">
        <ul className="-mx-2 -my-1 divide-y divide-border">
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

      {cancelling && (
        <ConfirmDialog
          title={`Batalkan ${event.name}?`}
          confirmLabel="Batalkan event"
          cancelLabel="Kembali"
          onConfirm={() => act(() => eventApi.cancel(token, event.id))}
          onClose={() => setCancelling(false)}
        >
          Semua blok yang sudah diambil akan dilepas, dan host mendapat pemberitahuan.
        </ConfirmDialog>
      )}
    </div>
  );
}

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

/** Strip colors, one segment per block: who has it at a glance. */
function blockColor(block: EventBlock): string {
  if (block.claim) return "bg-primary";
  if (block.state === "unavailable") return "bg-warning/50";
  if (block.state === "past") return "bg-border";
  return "bg-primary/15 ring-1 ring-inset ring-primary/40";
}

/** One day of the event in a line: a strip of its blocks, how many are taken and by whom. */
function DaySummary({ day, blocks, onOpen }: { day: string; blocks: EventBlock[]; onOpen: () => void }) {
  const claimed = blocks.filter((block) => block.claim).length;
  const open = blocks.filter((block) => !block.claim && block.state === "free").length;
  const holders = [...new Set(blocks.flatMap((block) => (block.claim ? [block.claim.host_name] : [])))];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-lg px-2 py-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
    >
      <span className="w-28 shrink-0">
        <span className="block text-sm font-semibold text-foreground">{formatDay(`${day}T00:00`)}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {claimed}/{blocks.length} terisi
        </span>
      </span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex gap-0.5" aria-hidden="true">
          {blocks.map((block) => (
            <span key={block.start_at} className={`h-2.5 flex-1 rounded-sm ${blockColor(block)}`} />
          ))}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {holders.length > 0
            ? `Diambil ${holders.slice(0, 3).join(", ")}${holders.length > 3 ? ` +${holders.length - 3} lainnya` : ""}`
            : "Belum ada yang mengambil"}
          {open > 0 && <span className="font-medium text-brand"> · {open} masih kosong</span>}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
    </button>
  );
}

function BlockLegend() {
  const items: [string, string][] = [
    ["bg-primary", "Terisi"],
    ["bg-primary/15 ring-1 ring-inset ring-primary/40", "Kosong"],
    ["bg-warning/50", "Ada jadwal reguler"],
    ["bg-border", "Lewat, tidak diambil"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
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
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-28 pb-2 font-medium sm:w-32">Jam</th>
            <th className="pb-2 font-medium">Host / status</th>
            <th className="pb-2 text-right font-medium">
              <span className="sr-only">Aksi</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {blocks.map((block) => {
            const upcoming = new Date(block.end_at) > new Date();
            return (
              <tr key={block.start_at} className={block.state === "past" && !block.claim ? "opacity-60" : ""}>
                <td className="py-2.5 align-top font-medium whitespace-nowrap text-foreground tabular-nums">
                  {formatClock(block.start_at)}–{formatClock(block.end_at)}
                </td>
                <td className="py-2.5">
                  {block.claim ? (
                    <span className="font-medium text-foreground">{block.claim.host_name}</span>
                  ) : block.state === "unavailable" ? (
                    <span className="text-faint">{block.reason}</span>
                  ) : (
                    <span className="text-muted-foreground">{block.state === "past" ? "Tidak diambil" : "Kosong"}</span>
                  )}
                  {assigning === block.start_at && (
                    <div className="mt-2 flex gap-2">
                      <NativeSelect
                        small
                        wrapperClassName="flex-1"
                        value={assignHostId || hosts[0]?.host_id || ""}
                        onChange={(change) => setAssignHostId(change.target.value)}
                        aria-label="Host"
                      >
                        {hosts.map((assignment) => (
                          <option key={assignment.host_id} value={assignment.host_id}>
                            {assignment.host.user.name}
                          </option>
                        ))}
                      </NativeSelect>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          const hostId = assignHostId || hosts[0]?.host_id;
                          if (hostId) run(() => eventApi.assign(token, eventId, block.start_at, hostId));
                        }}
                      >
                        Berikan blok
                      </Button>
                    </div>
                  )}
                </td>
                <td className="py-2.5 text-right whitespace-nowrap align-top">
                  {editable && upcoming ? (
                    <span className="inline-flex gap-1.5">
                      <Button type="button" variant="outline" size="xs" onClick={() => setAssigning(assigning === block.start_at ? null : block.start_at)}>
                        {assigning === block.start_at ? "Tutup" : block.claim ? "Ganti host" : "Tunjuk host"}
                      </Button>
                      {block.claim && (
                        <Button type="button" variant="ghost" size="xs" onClick={() => run(() => eventApi.release(token, block.claim!.id))} className="text-destructive hover:text-destructive">
                          Lepas
                        </Button>
                      )}
                    </span>
                  ) : (
                    <span className="text-faint">–</span>
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border pt-4 text-sm">
      <label className="flex items-center gap-2 text-body">
        Maks blok per host
        <input type="number" min={1} max={100} value={max} onChange={(event) => setMax(event.target.value)} className={cn(inputSmClass, "w-16 tabular-nums")} />
      </label>
      <label className="flex items-center gap-2 text-body">
        <Switch checked={full} onCheckedChange={setFull} />
        Gantikan jadwal reguler
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={Number(max) === maxPerHost && full === openFull}
        onClick={() => act(() => eventApi.update(token, eventId, { max_slots_per_host: Number(max), open_full_schedule: full }))}
        className="ml-auto"
      >
        Simpan pengaturan
      </Button>
    </div>
  );
}

function EventForm({ onDone, onCancel }: { onDone: (message: string, id: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const input = cn(inputClass, "tabular-nums");

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
    <label className="space-y-1.5">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {child}
      {errors[name] && <span className="block text-sm text-destructive">{errors[name]}</span>}
    </label>
  );

  return (
    <Modal title="Event baru" description="Host dari brand ini mengambil blok, siapa cepat dia dapat." onClose={onCancel} wide>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        {field(
          "Brand",
          "brand_id",
          <NativeSelect name="brand_id">
            {brands.data?.brands
              .filter((brand) => brand.status === "active")
              .map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
          </NativeSelect>
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
            <span className="text-sm text-muted-foreground">jam</span>
            <input name="block_extra_minutes" type="number" min={0} max={59} step={15} defaultValue={0} aria-label="Menit per blok" className={input} />
            <span className="text-sm text-muted-foreground">menit</span>
          </div>
        )}
        {field("Maks blok per host", "max_slots_per_host", <input name="max_slots_per_host" type="number" min={1} max={100} defaultValue={3} className={input} />)}
        <label className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-body sm:col-span-2">
          <input type="checkbox" name="open_full_schedule" className="size-4 accent-primary" />
          Gantikan jadwal reguler brand di hari-hari ini <span className="text-muted-foreground">(&quot;jadwal dibuka kosong&quot;)</span>
        </label>
        <FormActions loading={loading} submitLabel="Buat event" onCancel={onCancel} />
      </form>
    </Modal>
  );
}
