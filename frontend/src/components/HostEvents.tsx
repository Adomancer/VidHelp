"use client";

import { useState } from "react";
import { errorMessage, eventApi, type EventBlock, type HostEvent } from "@/lib/api";
import { formatClock, formatDate, formatDay } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import { groupByDay } from "@/lib/events";
import FormAlert from "./FormAlert";

const stateStyles: Record<EventBlock["state"], string> = {
  mine: "bg-green-500/15 border-green-400/40",
  free: "bg-slate-800 border-slate-700",
  taken: "bg-slate-800/40 border-slate-800",
  past: "bg-slate-800/40 border-slate-800 opacity-50",
  unavailable: "bg-slate-800/40 border-slate-800",
  busy: "bg-slate-800/40 border-slate-800",
};

/**
 * Special events of my brands: claim free blocks (first come, first served) or give mine back.
 */
export default function HostEvents() {
  const { token } = useAuth();
  const events = useApiData("host-events", () => eventApi.mine(token));
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function act(action: () => Promise<{ message: string }>) {
    setNotice(null);
    try {
      setNotice({ tone: "success", text: (await action()).message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    }
    events.reload();
  }

  if (!events.data || events.data.events.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-white">Special events</h2>
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {events.data.events.map((event) => (
        <EventCard key={event.id} event={event} act={act} />
      ))}
    </div>
  );
}

function EventCard({ event, act }: { event: HostEvent; act: (action: () => Promise<{ message: string }>) => Promise<void> }) {
  const { token } = useAuth();
  const full = event.my_claims >= event.max_slots_per_host;

  return (
    <Card>
      <div>
        <p className="text-white font-medium">
          {event.name} · {event.brand?.name}
        </p>
        <p className="text-xs text-gray-400">
          {formatDate(event.start_date)}
          {event.end_date !== event.start_date ? ` – ${formatDate(event.end_date)}` : ""} · you hold {event.my_claims} of max{" "}
          {event.max_slots_per_host} blocks
          {event.open_full_schedule ? " · replaces the regular schedule" : ""}
        </p>
      </div>

      {groupByDay(event.blocks).map(([day, blocks]) => (
        <div key={day} className="space-y-1.5">
          <p className="text-xs font-medium text-gray-300">{formatDay(`${day}T00:00`)}</p>
          <ul className="space-y-1.5">
            {blocks.map((block) => (
              <li key={block.start_at} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${stateStyles[block.state]}`}>
                <span className="w-24 text-sm text-purple-200">
                  {formatClock(block.start_at)}–{formatClock(block.end_at)}
                </span>
                <span className="flex-1 min-w-0 text-xs text-gray-400 truncate">
                  {block.state === "mine" && <span className="text-green-300">Yours</span>}
                  {block.state === "taken" && block.claim?.host_name}
                  {(block.state === "busy" || block.state === "unavailable") && block.reason}
                </span>
                {block.state === "free" && (
                  <button
                    type="button"
                    disabled={full}
                    title={full ? "You reached the maximum for this event" : undefined}
                    onClick={() => act(() => eventApi.claim(token, event.id, block.start_at))}
                    className="px-3 py-1 rounded-md bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-40"
                  >
                    Claim
                  </button>
                )}
                {block.state === "mine" && new Date(block.start_at) > new Date() && block.claim && (
                  <button
                    type="button"
                    onClick={() => confirm("Give this block back?") && act(() => eventApi.cancelClaim(token, block.claim!.id))}
                    className="text-xs text-red-300 hover:text-red-200"
                  >
                    Release
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}
