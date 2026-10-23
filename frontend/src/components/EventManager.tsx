"use client";

import { useState } from "react";
import { useQueryState } from "nuqs";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Ticket } from "lucide-react";
import { eventApi, scheduleApi, type BrandHost } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import FilterCombobox, { type FilterOption } from "./FilterCombobox";
import { CardsSkeleton } from "./Loading";
import PageHeader from "./PageHeader";
import { notifyCapsule } from "./Toast";
import { EventBoard } from "./events/EventBoard";
import { EventForm } from "./events/EventForm";
import { activeHosts, dateRange, type HostLite, TALL } from "./events/shared";

/**
 * Admin/operator: special events (PD, double date). Narrow the list by brand, host or event,
 * see every day as a card of blocks, and click a block to give it to a host or take it back.
 */
export default function EventManager() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
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
