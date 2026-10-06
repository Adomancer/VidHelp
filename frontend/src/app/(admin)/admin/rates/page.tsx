"use client";

import { useState } from "react";
import { adminHostsApi, errorMessage, type RateCategory, type RateCategoryInput } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";
import RupiahInput from "@/components/RupiahInput";

export default function AdminRatesPage() {
  const { token } = useAuth();
  const levels = useApiData("rates", () => adminHostsApi.rateCategories(token));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Level Tarif</h1>
        <p className="text-sm text-gray-400 mt-1">
          Setiap malam host otomatis naik ke level tertinggi sesuai masa kerjanya, kecuali levelnya diatur manual di
          halaman host. Mengubah level di sini langsung menempatkan ulang para host.
        </p>
      </div>

      {levels.error && <FormAlert tone="error">{levels.error}</FormAlert>}

      <Card>
        <div className="hidden sm:grid grid-cols-[1fr_8rem_10rem_auto] gap-3 text-xs text-gray-400 px-1">
          <span>Nama</span>
          <span>Mulai bulan ke-</span>
          <span>Tarif per jam</span>
          <span className="w-36" />
        </div>
        <div className="space-y-3">
          {levels.data?.rate_categories.map((level) => (
            <LevelRow key={`${level.id}-${level.rate_per_hour}-${level.min_tenure_months}`} level={level} hostsCount={level.hosts_count} onChanged={levels.reload} />
          ))}
          <LevelRow key={`new-${levels.data?.rate_categories.length}`} onChanged={levels.reload} />
        </div>
      </Card>
    </div>
  );
}

function LevelRow({ level, hostsCount = 0, onChanged }: { level?: RateCategory; hostsCount?: number; onChanged: () => void }) {
  const { token } = useAuth();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { loading, errors, error, handleSubmit } = useApiForm((data) => {
    const input: RateCategoryInput = {
      name: formValue(data, "name"),
      min_tenure_months: Number(formValue(data, "min_tenure_months")),
      rate_per_hour: Number(formValue(data, "rate_per_hour")),
    };
    return level ? adminHostsApi.updateRateCategory(token, level.id, input) : adminHostsApi.createRateCategory(token, input);
  }, onChanged);

  async function remove() {
    if (!level || !confirm(`Hapus "${level.name}"?`)) return;
    try {
      await adminHostsApi.deleteRateCategory(token, level.id);
      onChanged();
    } catch (caught) {
      setDeleteError(errorMessage(caught));
    }
  }

  const input = "w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:ring-2 focus:ring-purple-500";
  const message = error ?? deleteError ?? Object.values(errors)[0];

  return (
    <form onSubmit={handleSubmit} className="space-y-1" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_10rem_auto] gap-3 items-center">
        <input name="name" defaultValue={level?.name} placeholder="Nama level baru" aria-label="Nama" className={input} />
        <input name="min_tenure_months" type="number" min={0} defaultValue={level?.min_tenure_months} placeholder="Bulan" aria-label="Mulai bulan ke-" className={input} />
        <RupiahInput name="rate_per_hour" defaultValue={level?.rate_per_hour} placeholder="0" aria-label="Tarif per jam" className={input} />
        <div className="flex gap-2 w-36">
          <button type="submit" disabled={loading} className="flex-1 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-50">
            {level ? "Simpan" : "Tambah"}
          </button>
          {level && (
            <button
              type="button"
              onClick={remove}
              disabled={hostsCount > 0}
              title={hostsCount > 0 ? "Dipakai oleh host" : "Hapus"}
              className="px-3 py-2 rounded-lg border border-slate-700 text-gray-300 text-sm hover:bg-slate-800 disabled:opacity-40"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {level && <p className="text-xs text-gray-500 px-1">Dipakai {hostsCount} host</p>}
      {message && <p className="text-sm text-red-300 px-1">{message}</p>}
    </form>
  );
}
