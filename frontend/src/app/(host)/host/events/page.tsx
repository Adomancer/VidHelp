"use client";

import { RefreshCw, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import EmptyState from "@/components/EmptyState";
import EventClaimBoard, { BOARD_REFRESH_MS, useHostEvents } from "@/components/EventClaimBoard";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

/** "Rebutan event": hosts grab blocks of the events staff set up for their brands. */
export default function HostEventsPage() {
  const { user } = useAuth();
  const isHost = user.roles.some((role) => role.name === "host");
  const events = useHostEvents(isHost, BOARD_REFRESH_MS);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rebutan event"
        description="Siapa cepat dia dapat. Ambil blok live event dari brand kamu; tiap event punya batas blok per host."
        actions={
          isHost && (
            <Button type="button" variant="outline" onClick={events.reload} disabled={events.loading}>
              <RefreshCw className={cn(events.loading && "animate-spin")} aria-hidden="true" />
              Segarkan
            </Button>
          )
        }
      />
      {isHost ? (
        <EventClaimBoard events={events} />
      ) : (
        <Card>
          <EmptyState icon={Ticket} title="Halaman ini untuk host" description="Atur event dan bloknya di menu Event pada dashboard." />
        </Card>
      )}
    </div>
  );
}
