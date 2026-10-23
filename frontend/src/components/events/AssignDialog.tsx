"use client";

import { useState } from "react";
import { errorMessage, eventApi, type EventBlock, type SpecialEvent } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "../AuthProvider";
import Dialog from "../Dialog";
import FilterCombobox from "../FilterCombobox";
import FormAlert from "../FormAlert";
import { notifyCapsule } from "../Toast";
import { blockTime, dayOf, type HostLite, TALL } from "./shared";

/** Give a block to a host, change who holds it, or take it back. */
export function AssignDialog({
  event,
  block,
  hosts,
  hostsLoading,
  held,
  onClose,
  onDone,
}: {
  event: SpecialEvent;
  block: EventBlock;
  hosts: HostLite[];
  hostsLoading: boolean;
  held: Map<string, number>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { token } = useAuth();
  const holder = block.claim;
  const [hostId, setHostId] = useState(holder?.host_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const time = blockTime(block);
  const options: HostLite[] = holder && !hosts.some((host) => host.id === holder.host_id) ? [{ id: holder.host_id, name: holder.host_name }, ...hosts] : hosts;
  const nameOf = (id: string) => options.find((host) => host.id === id)?.name ?? "Host";

  async function run(action: () => Promise<{ message: string }>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      notifyCapsule(message);
      await onDone();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  function save() {
    if (!hostId) return setError("Pilih host dulu.");
    if (hostId === holder?.host_id) return onClose();
    if ((held.get(hostId) ?? 0) >= event.max_slots_per_host) {
      return setError(`${nameOf(hostId)} sudah memegang ${event.max_slots_per_host} blok, batas maksimum per host di event ini.`);
    }
    void run(() => eventApi.assign(token, event.id, block.start_at, hostId), `${nameOf(hostId)} ditunjuk untuk ${time}`);
  }

  return (
    <Dialog
      title="Tunjuk host ke blok"
      description={`${dayOf(block.start_at)} · ${time}`}
      size="md"
      placement="side"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={busy} className={TALL}>
            Tutup
          </Button>
          {holder && (
            <Button
              type="button"
              variant="destructive"
              size="lg"
              disabled={busy}
              onClick={() => void run(() => eventApi.release(token, holder.id), `${holder.host_name} dilepas dari ${time}`)}
              className={TALL}
            >
              Lepas
            </Button>
          )}
          <Button type="button" size="lg" onClick={save} disabled={busy} className={TALL}>
            {busy ? "Menyimpan…" : "Simpan"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-body">
          {holder ? (
            <>
              Dipegang oleh <span className="font-semibold text-foreground">{holder.host_name}</span>.
            </>
          ) : (
            "Belum ada host yang memegang blok ini."
          )}
        </p>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <div className="space-y-1.5">
          <Label htmlFor="assign-host">Host</Label>
          <FilterCombobox
            id="assign-host"
            options={options.map((host) => {
              const count = held.get(host.id) ?? 0;
              const full = count >= event.max_slots_per_host && host.id !== holder?.host_id;
              return { value: host.id, label: host.name, meta: `${count}/${event.max_slots_per_host} blok${full ? " (penuh)" : ""}` };
            })}
            value={hostId || null}
            onChange={(value) => {
              setHostId(value ?? "");
              setError(null);
            }}
            placeholder={hostsLoading ? "Memuat host…" : options.length === 0 ? "Tidak ada host di brand ini" : "Ketik atau pilih host"}
            empty={`Tidak ada host ${event.brand?.name ?? "brand ini"} dengan nama itu.`}
          />
          <p className="text-xs text-muted-foreground">
            Hanya host {event.brand?.name ?? "brand ini"}. Maksimal {event.max_slots_per_host} blok per host di event ini.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
