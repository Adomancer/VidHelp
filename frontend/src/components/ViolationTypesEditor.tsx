"use client";

import { useState } from "react";
import { errorMessage, pointsApi, type ViolationType } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";

/**
 * Admin list of violation types: points deducted, rating impact, on/off.
 * Types marked "automatic" are also applied by the system.
 */
export default function ViolationTypesEditor() {
  const { token } = useAuth();
  const types = useApiData("all-violation-types", () => pointsApi.allViolationTypes(token));
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function save(action: () => Promise<{ message: string }>) {
    setNotice(null);
    try {
      setNotice({ tone: "success", text: (await action()).message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    }
    types.reload();
  }

  return (
    <Card title="Jenis pelanggaran" description="Poin dipotong dari saldo 3 bulanan; dampak rating menurunkan saran rating bulanan.">
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      <div className="hidden sm:grid grid-cols-[1fr_6rem_6rem_5rem_4.5rem] gap-2 text-xs text-gray-400 px-1">
        <span>Nama</span>
        <span>Poin</span>
        <span>Rating −</span>
        <span>Aktif</span>
        <span />
      </div>
      <div className="space-y-2">
        {types.data?.violation_types.map((type) => (
          <TypeRow key={`${type.id}-${type.default_points}-${type.rating_impact}-${type.is_active}`} type={type} onSave={save} />
        ))}
        <TypeRow key={`new-${types.data?.violation_types.length}`} onSave={save} />
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
  const input = "w-full px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-white text-sm";

  function submit() {
    const data = { name, default_points: Number(points), rating_impact: Number(impact) };
    onSave(() => (type ? pointsApi.updateViolationType(token, type.id, { ...data, is_active: active }) : pointsApi.createViolationType(token, data)));
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-[1fr_6rem_6rem_5rem_4.5rem] gap-2 items-center">
      <div className="col-span-2 sm:col-span-1">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jenis pelanggaran baru" aria-label="Nama" className={input} />
        {type?.code && <span className="text-[11px] text-purple-300">otomatis</span>}
      </div>
      <input type="number" min={0} max={100} value={points} onChange={(event) => setPoints(event.target.value)} aria-label="Poin" className={input} />
      <input type="number" min={0} max={4} step={0.1} value={impact} onChange={(event) => setImpact(event.target.value)} aria-label="Dampak rating" className={input} />
      <label className="flex items-center gap-2 text-sm text-gray-300">
        <input type="checkbox" checked={active} disabled={!type} onChange={(event) => setActive(event.target.checked)} className="accent-purple-500" />
        {active ? "aktif" : "nonaktif"}
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={!name.trim() || points === "" || impact === ""}
        className="px-3 py-1.5 rounded-md bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-40"
      >
        {type ? "Simpan" : "Tambah"}
      </button>
    </div>
  );
}
