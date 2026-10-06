"use client";

import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import EventClaimBoard, { BOARD_REFRESH_MS, useHostEvents } from "@/components/EventClaimBoard";

/** "Rebutan event": hosts grab blocks of the events staff set up for their brands. */
export default function HostEventsPage() {
  const { user } = useAuth();
  const isHost = user.roles.some((role) => role.name === "host");
  const events = useHostEvents(isHost, BOARD_REFRESH_MS);

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-bold text-white">Rebutan Event</h1>
      {isHost ? (
        <EventClaimBoard events={events} />
      ) : (
        <Card>
          <p className="text-sm text-gray-400">Halaman ini untuk host. Atur event dan bloknya di menu Events pada dashboard.</p>
        </Card>
      )}
    </div>
  );
}
