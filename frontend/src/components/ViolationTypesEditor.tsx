"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { errorMessage, pointsApi, type ViolationType } from "@/lib/api";
import { inputSmClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
import { ListSkeleton } from "./Loading";
import StatusBadge from "./StatusBadge";
import { notify } from "./Toast";

/**
 * Admin list of violation types: points deducted, rating impact, on/off.
 * Types marked "automatic" are also applied by the system.
 */
export default function ViolationTypesEditor() {
  const { token } = useAuth();
  const types = useApiData("all-violation-types", () => pointsApi.allViolationTypes(token));
  const [error, setError] = useState<string | null>(null);

  async function save(action: () => Promise<{ message: string }>) {
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    types.reload();
  }

  return (
    <Card title="Jenis pelanggaran" description="Poin dipotong dari saldo 3 bulanan; dampak rating menurunkan saran rating bulanan." bodyClassName="px-0 md:px-0">
      {error && (
        <div className="px-5 md:px-6">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <div className="hidden grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem_6rem] gap-3 border-y border-border bg-muted/50 px-5 py-2.5 text-xs font-medium text-muted-foreground sm:grid md:px-6">
        <span>Nama</span>
        <span>Poin</span>
        <span>Dampak rating</span>
        <span>Aktif</span>
        <span className="sr-only">Aksi</span>
      </div>
      {!types.data && <ListSkeleton rows={3} className="px-5 md:px-6" />}
      <div className="divide-y divide-border">
        {types.data?.violation_types.map((type) => (
          <TypeRow key={`${type.id}-${type.default_points}-${type.rating_impact}-${type.is_active}`} type={type} onSave={save} />
        ))}
        {types.data && <TypeRow key={`new-${types.data.violation_types.length}`} onSave={save} />}
      </div>
    </Card>
  );
}

function TypeRow({ type, onSave }: { type?: ViolationType; onSave: (action: () => Promise<{ message: string }>) => Promise<void> }) {
  const { token } = useAuth();
  const [name, setName] = useState(type?.name ?? "");
  const [points, setPoints] = useState(String(type?.default_points ?? ""));
  const [impact, setImpact] = useState(String(type?.rating_impact ?? ""));
  const [active, setActive] = useState(type?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const data = { name, default_points: Number(points), rating_impact: Number(impact) };
    setSaving(true);
    await onSave(() => (type ? pointsApi.updateViolationType(token, type.id, { ...data, is_active: active }) : pointsApi.createViolationType(token, data)));
    setSaving(false);
  }

  return (
    <div className={cn("grid grid-cols-2 items-center gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem_6rem] md:px-6", !type && "bg-muted/30")}>
      <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jenis pelanggaran baru" aria-label="Nama" className={inputSmClass} />
        {type?.code && (
          <StatusBadge tone="brand" className="h-5 px-1.5 text-[10px]" title="Juga diterapkan otomatis oleh sistem">
            otomatis
          </StatusBadge>
        )}
      </div>
      <input
        type="number"
        min={0}
        max={100}
        value={points}
        onChange={(event) => setPoints(event.target.value)}
        aria-label="Poin"
        placeholder="Poin"
        className={cn(inputSmClass, "tabular-nums")}
      />
      <input
        type="number"
        min={0}
        max={4}
        step={0.1}
        value={impact}
        onChange={(event) => setImpact(event.target.value)}
        aria-label="Dampak rating"
        placeholder="Rating"
        className={cn(inputSmClass, "tabular-nums")}
      />
      <label className="flex items-center gap-2 text-sm text-body">
        <Switch checked={active} disabled={!type} onCheckedChange={setActive} />
        {active ? "Aktif" : "Nonaktif"}
      </label>
      <Button type="button" size="sm" variant={type ? "outline" : "default"} onClick={submit} disabled={saving || !name.trim() || points === "" || impact === ""}>
        {!type && <Plus aria-hidden="true" />}
        {saving ? "Menyimpan…" : type ? "Simpan" : "Tambah"}
      </Button>
    </div>
  );
}
