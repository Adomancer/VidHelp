"use client";

import { useState } from "react";
import { errorMessage, eventApi, operatorApi, scheduleApi, type EventInput, type EventListItem } from "@/lib/api";
import { groupByDay } from "@/lib/events";
import { formatClock, formatDate, formatDay, formatDuration, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
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
        <button type="button" onClick={() => setCreating(!creating)} className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500">
          {creating ? "Close" : "New event"}
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
        />
      )}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {events.error && <FormAlert tone="error">{events.error}</FormAlert>}

      {events.data && active.length === 0 && (
        <Card>
          <p className="text-sm text-gray-400">No events yet. Create one for a PD or double-date campaign.</p>
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
      className={`w-full text-left rounded-lg px-3 py-2 border ${selected ? "bg-purple-600/20 border-purple-500/50" : "bg-slate-900 border-slate-800 hover:bg-slate-800"}`}
    >
      <p className={`text-sm font-medium ${event.status === "cancelled" ? "text-gray-500 line-through" : "text-white"}`}>{event.name}</p>
      <p className="text-xs text-gray-400">
        {event.brand?.name} · {formatDate(event.start_date)}
        {event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ""}
      </p>
      <p className="text-xs text-gray-500">
        {event.status === "cancelled" ? "cancelled" : `${event.claimed_blocks}/${event.total_blocks} blocks taken`}
      </p>
    </button>
  );
}

function EventDetail({ eventId, onChanged }: { eventId: string; onChanged: (text: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`event-${eventId}`, () => eventApi.show(token, eventId));
  const brandId = detail.data?.event.brand_id ?? "";
  const hosts = useApiData(`event-hosts-${brandId}`, () => (brandId ? scheduleApi.brandHosts(token, brandId) : Promise.resolve({ assignments: [] })));
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignHostId, setAssignHostId] = useState("");

  async function act(action: () => Promise<{ message: string }>) {
    try {
      onChanged((await action()).message);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
    setAssigning(null);
    detail.reload();
  }

  if (detail.error) return <FormAlert tone="error">{detail.error}</FormAlert>;
  if (!detail.data) return <p className="text-gray-400">Loading…</p>;
  const { event, blocks } = detail.data;
  const cancelled = event.status === "cancelled";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg text-white font-medium">{event.name}</p>
            <p className="text-sm text-gray-400">
              {event.brand?.name} · daily {event.daily_start_time}–{event.daily_end_time} · blocks of {formatDuration(event.block_minutes / 60)} · max{" "}
              {event.max_slots_per_host} per host
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {event.open_full_schedule ? "Replaces the regular schedule on these days." : "Runs next to the regular schedule; hours already scheduled can't be claimed."}
            </p>
          </div>
          {!cancelled && (
            <button
              type="button"
              onClick={() => confirm(`Cancel ${event.name}? Every claimed block is released.`) && act(() => eventApi.cancel(token, event.id))}
              className="px-3 py-1.5 rounded-lg border border-red-400/40 text-red-300 text-sm hover:bg-red-500/10"
            >
              Cancel event
            </button>
          )}
        </div>
        {!cancelled && <EventSettings key={`${event.max_slots_per_host}-${event.open_full_schedule}`} eventId={event.id} maxPerHost={event.max_slots_per_host} openFull={event.open_full_schedule} act={act} />}
      </Card>

      {groupByDay(blocks).map(([day, dayBlocks]) => (
        <Card key={day} title={formatDay(`${day}T00:00`)}>
          <ul className="space-y-2">
            {dayBlocks.map((block) => (
              <li key={block.start_at} className="rounded-lg bg-slate-800 px-3 py-2 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-28 text-sm text-purple-200">
                    {formatClock(block.start_at)}–{formatClock(block.end_at)}
                  </span>
                  <span className="flex-1 min-w-32 text-sm">
                    {block.claim ? (
                      <span className="text-white">{block.claim.host_name}</span>
                    ) : block.state === "unavailable" ? (
                      <span className="text-gray-500">{block.reason}</span>
                    ) : (
                      <span className="text-gray-400">{block.state === "past" ? "not claimed" : "free"}</span>
                    )}
                  </span>
                  {!cancelled && new Date(block.end_at) > new Date() && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setAssigning(assigning === block.start_at ? null : block.start_at)} className="text-xs text-purple-300 hover:text-white">
                        {block.claim ? "Reassign" : "Assign"}
                      </button>
                      {block.claim && (
                        <button type="button" onClick={() => act(() => eventApi.release(token, block.claim!.id))} className="text-xs text-red-300 hover:text-red-200">
                          Release
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {assigning === block.start_at && (
                  <div className="flex gap-2">
                    <select
                      value={assignHostId || hosts.data?.assignments[0]?.host_id || ""}
                      onChange={(change) => setAssignHostId(change.target.value)}
                      aria-label="Host"
                      className="flex-1 px-2 py-1.5 rounded-md bg-slate-900 border border-slate-700 text-white text-sm"
                    >
                      {hosts.data?.assignments.map((assignment) => (
                        <option key={assignment.host_id} value={assignment.host_id}>
                          {assignment.host.user.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const hostId = assignHostId || hosts.data?.assignments[0]?.host_id;
                        if (hostId) act(() => eventApi.assign(token, event.id, block.start_at, hostId));
                      }}
                      className="px-3 py-1.5 rounded-md bg-purple-600 text-white text-sm hover:bg-purple-500"
                    >
                      Give block
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
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
    <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 pt-3 text-sm">
      <label className="flex items-center gap-2 text-gray-300">
        Max blocks per host
        <input type="number" min={1} max={100} value={max} onChange={(event) => setMax(event.target.value)} className="w-16 px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-white" />
      </label>
      <label className="flex items-center gap-2 text-gray-300">
        <input type="checkbox" checked={full} onChange={(event) => setFull(event.target.checked)} className="accent-purple-500" />
        Replace the regular schedule
      </label>
      <button
        type="button"
        onClick={() => act(() => eventApi.update(token, eventId, { max_slots_per_host: Number(max), open_full_schedule: full }))}
        className="px-3 py-1 rounded-md border border-slate-700 text-gray-300 hover:bg-slate-800"
      >
        Save
      </button>
    </div>
  );
}

function EventForm({ onDone }: { onDone: (message: string, id: string) => void }) {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const input = "w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white";

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
      <span className="block text-xs text-gray-400">{label}</span>
      {child}
      {errors[name] && <span className="block text-xs text-red-300">{errors[name]}</span>}
    </label>
  );

  return (
    <Card title="New event" description="Hosts of the brand claim the blocks, first come first served.">
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
        {field("Name", "name", <input name="name" placeholder="PD 10.10" maxLength={100} className={input} />)}
        {field("First day", "start_date", <input name="start_date" type="date" defaultValue={toDateInput()} min={toDateInput()} className={input} />)}
        {field("Last day", "end_date", <input name="end_date" type="date" defaultValue={toDateInput()} min={toDateInput()} className={input} />)}
        {field("Opens each day at", "daily_start_time", <input name="daily_start_time" type="time" defaultValue="10:00" className={input} />)}
        {field("Closes at (can be after midnight)", "daily_end_time", <input name="daily_end_time" type="time" defaultValue="22:00" className={input} />)}
        {field(
          "Block length",
          "block_minutes",
          <div className="flex items-center gap-2">
            <input name="block_hours" type="number" min={0} max={12} defaultValue={2} aria-label="Block hours" className={input} />
            <span className="text-sm text-gray-400">h</span>
            <input name="block_extra_minutes" type="number" min={0} max={59} step={15} defaultValue={0} aria-label="Block minutes" className={input} />
            <span className="text-sm text-gray-400">min</span>
          </div>
        )}
        {field("Max blocks per host", "max_slots_per_host", <input name="max_slots_per_host" type="number" min={1} max={100} defaultValue={3} className={input} />)}
        <label className="flex items-center gap-2 text-sm text-gray-200 sm:col-span-2">
          <input type="checkbox" name="open_full_schedule" className="accent-purple-500" />
          Replace the brand&apos;s regular schedule on these days (&quot;jadwal dibuka kosong&quot;)
        </label>
        <div className="w-40">
          <SubmitButton loading={loading}>Create event</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
