"use client";

import { useState } from "react";
import { adminHostsApi, errorMessage, type RateCategory, type RateCategoryInput } from "@/lib/api";
import { formatRupiah } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";

export default function AdminRatesPage() {
  const { token } = useAuth();
  const levels = useApiData("rates", () => adminHostsApi.rateCategories(token));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Rate Levels</h1>
        <p className="text-sm text-gray-400 mt-1">
          Every night hosts move up to the highest level their tenure qualifies for, unless you set their level by hand on
          their host page. Changing levels here re-places hosts right away.
        </p>
      </div>

      {levels.error && <FormAlert tone="error">{levels.error}</FormAlert>}

      <Card>
        <div className="hidden sm:grid grid-cols-[1fr_8rem_10rem_auto] gap-3 text-xs text-gray-400 px-1">
          <span>Name</span>
          <span>From month</span>
          <span>Rate per hour (Rp)</span>
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
    if (!level || !confirm(`Delete "${level.name}"?`)) return;
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
        <input name="name" defaultValue={level?.name} placeholder="New level name" aria-label="Name" className={input} />
        <input name="min_tenure_months" type="number" min={0} defaultValue={level?.min_tenure_months} placeholder="Months" aria-label="From month" className={input} />
        <input name="rate_per_hour" type="number" min={0} step={500} defaultValue={level ? Number(level.rate_per_hour) : undefined} placeholder="Rate" aria-label="Rate per hour" className={input} />
        <div className="flex gap-2 w-36">
          <button type="submit" disabled={loading} className="flex-1 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-50">
            {level ? "Save" : "Add"}
          </button>
          {level && (
            <button
              type="button"
              onClick={remove}
              disabled={hostsCount > 0}
              title={hostsCount > 0 ? "Used by hosts" : "Delete"}
              className="px-3 py-2 rounded-lg border border-slate-700 text-gray-300 text-sm hover:bg-slate-800 disabled:opacity-40"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {level && (
        <p className="text-xs text-gray-500 px-1">
          {hostsCount} host{hostsCount === 1 ? "" : "s"} · {formatRupiah(level.rate_per_hour)}/hour
        </p>
      )}
      {message && <p className="text-sm text-red-300 px-1">{message}</p>}
    </form>
  );
}
