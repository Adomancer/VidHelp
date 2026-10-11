"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { adminHostsApi, errorMessage, type RateCategory, type RateCategoryInput } from "@/lib/api";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import ConfirmDialog from "@/components/ConfirmDialog";
import ErrorState from "@/components/ErrorState";
import { FieldError } from "@/components/FieldMessage";
import { ListSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import RupiahInput from "@/components/RupiahInput";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";

export default function AdminRatesPage() {
  const { token } = useAuth();
  const levels = useApiData("rates", () => adminHostsApi.rateCategories(token));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Level tarif"
        description="Setiap malam host otomatis naik ke level tertinggi sesuai masa kerjanya, kecuali levelnya diatur manual di halaman Host. Mengubah level di sini langsung menempatkan ulang para host."
      />

      {levels.error && <ErrorState message={levels.error} onRetry={levels.reload} />}

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <div className="hidden grid-cols-[minmax(0,1fr)_8rem_11rem_9rem] gap-3 border-b border-border bg-muted/50 px-4 py-3 text-xs font-medium text-muted-foreground sm:grid">
          <span>Nama level</span>
          <span>Mulai bulan ke-</span>
          <span>Tarif per jam</span>
          <span className="sr-only">Aksi</span>
        </div>
        {!levels.data && !levels.error && <ListSkeleton rows={3} className="p-4" />}
        <div className="divide-y divide-border">
          {levels.data?.rate_categories.map((level) => (
            <LevelRow key={`${level.id}-${level.rate_per_hour}-${level.min_tenure_months}`} level={level} hostsCount={level.hosts_count} onChanged={levels.reload} />
          ))}
          {levels.data && <LevelRow key={`new-${levels.data.rate_categories.length}`} onChanged={levels.reload} />}
        </div>
      </section>
    </div>
  );
}

function LevelRow({ level, hostsCount = 0, onChanged }: { level?: RateCategory; hostsCount?: number; onChanged: () => void }) {
  const { token } = useAuth();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => {
      const input: RateCategoryInput = {
        name: formValue(data, "name"),
        min_tenure_months: Number(formValue(data, "min_tenure_months")),
        rate_per_hour: Number(formValue(data, "rate_per_hour")),
      };
      return level ? adminHostsApi.updateRateCategory(token, level.id, input) : adminHostsApi.createRateCategory(token, input);
    },
    () => {
      notify({ text: level ? `Level ${level.name} disimpan` : "Level baru ditambahkan" });
      onChanged();
    }
  );

  async function remove() {
    if (!level) return;
    try {
      await adminHostsApi.deleteRateCategory(token, level.id);
      notify({ text: `Level ${level.name} dihapus` });
      onChanged();
    } catch (caught) {
      setDeleteError(errorMessage(caught));
    }
  }

  const message = error ?? deleteError ?? Object.values(errors)[0];

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-1.5 px-4 py-3", !level && "bg-muted/30")} noValidate>
      {!level && <p className="text-xs font-medium text-muted-foreground sm:hidden">Level baru</p>}
      <div className="grid grid-cols-2 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_11rem_9rem]">
        <input name="name" defaultValue={level?.name} placeholder="Nama level baru" aria-label="Nama level" className={cn(inputClass, "col-span-2 sm:col-span-1")} />
        <input
          name="min_tenure_months"
          type="number"
          min={0}
          defaultValue={level?.min_tenure_months}
          placeholder="Bulan"
          aria-label="Mulai bulan ke-"
          className={cn(inputClass, "tabular-nums")}
        />
        <RupiahInput name="rate_per_hour" defaultValue={level?.rate_per_hour} placeholder="0" aria-label="Tarif per jam" />
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <Button type="submit" variant={level ? "outline" : "default"} disabled={loading} className="flex-1">
            {!level && <Plus aria-hidden="true" />}
            {loading ? "Menyimpan…" : level ? "Simpan" : "Tambah"}
          </Button>
          {level && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setConfirming(true)}
              disabled={hostsCount > 0}
              title={hostsCount > 0 ? "Masih dipakai host" : "Hapus level"}
              aria-label={`Hapus ${level.name}`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      {level && <p className="text-xs text-muted-foreground">Dipakai {hostsCount} host</p>}
      <FieldError>{message}</FieldError>

      {confirming && level && (
        <ConfirmDialog title={`Hapus level "${level.name}"?`} confirmLabel="Hapus level" onConfirm={remove} onClose={() => setConfirming(false)}>
          Level ini tidak dipakai host mana pun, jadi aman dihapus.
        </ConfirmDialog>
      )}
    </form>
  );
}
