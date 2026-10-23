"use client";

import { useState } from "react";
import { adminHostsApi, shownKeys, splitApiError, type BrandInput, type BrandSummary } from "@/lib/api";
import { inputClass } from "@/lib/ui";
import { formValue } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import DatePicker from "@/components/DatePicker";
import Dialog from "@/components/Dialog";
import { FieldError, FieldHint } from "@/components/FieldMessage";
import SelectField from "@/components/SelectField";
import { notifyCapsule } from "@/components/Toast";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TOAST_MS } from "./shared";

const DEFAULT_TARGET = 720;

/** Checks before sending; an empty target becomes 720. */
function check(data: FormData): { errors: Record<string, string>; target: number } {
  const errors: Record<string, string> = {};
  const name = formValue(data, "name").trim();
  const raw = formValue(data, "target_hours_per_period").trim();
  const target = raw === "" ? DEFAULT_TARGET : Number(raw);

  if (!name) errors.name = "Nama brand wajib diisi.";
  else if (name.length > 80) errors.name = "Nama brand maksimal 80 karakter.";
  if (!Number.isInteger(target) || target <= 0) errors.target_hours_per_period = "Target harus angka bulat lebih dari 0.";
  else if (target > 10000) errors.target_hours_per_period = "Target maksimal 10.000 jam.";

  return { errors, target };
}

export function BrandForm({ brand, onSaved, onClose }: { brand: BrandSummary | null; onSaved: () => void; onClose: () => void }) {
  const { token } = useAuth();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const { errors: found, target } = check(data);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: BrandInput = {
      name: formValue(data, "name").trim(),
      is_obs: data.get("is_obs") === "on",
      target_hours_per_period: target,
      payroll_start_date: formValue(data, "payroll_start_date") || null,
      status: (formValue(data, "status") || "active") as BrandInput["status"],
    };

    setSaving(true);
    try {
      await (brand ? adminHostsApi.updateBrand(token, brand.id, input) : adminHostsApi.createBrand(token, input));
      notifyCapsule(brand ? "Brand diperbarui" : "Brand ditambahkan", "success", TOAST_MS);
      onSaved();
    } catch (caught) {
      const { fields, message } = splitApiError(caught, shownKeys("name", "target_hours_per_period"));
      setErrors(fields);
      // The server's reason (permission, conflict, offline…) unless the marked fields already say it
      notifyCapsule(message ?? "Periksa isian yang ditandai", "error", TOAST_MS);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={brand ? "Edit brand" : "Brand baru"}
      size="lg"
      onClose={onClose}
      dirty={dirty && !saving}
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="brand-form" size="lg" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </>
      }
    >
      <form id="brand-form" onSubmit={submit} onChange={() => setDirty(true)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="name">
            Nama <span className="text-destructive">*</span>
          </Label>
          <input
            id="name"
            name="name"
            defaultValue={brand?.name}
            maxLength={80}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "name-error" : undefined}
            className={inputClass}
          />
          <FieldError id="name-error">{errors.name}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="target_hours_per_period">Target jam per periode</Label>
          <input
            id="target_hours_per_period"
            name="target_hours_per_period"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            placeholder={String(DEFAULT_TARGET)}
            defaultValue={brand?.target_hours_per_period}
            aria-invalid={errors.target_hours_per_period ? true : undefined}
            className={cn(inputClass, "tabular-nums")}
          />
          {errors.target_hours_per_period ? (
            <FieldError>{errors.target_hours_per_period}</FieldError>
          ) : (
            <FieldHint>720 jam ≈ 1 bulan. Dikosongkan = 720.</FieldHint>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="payroll_start_date">Mulai penggajian</Label>
          <DatePicker
            id="payroll_start_date"
            name="payroll_start_date"
            defaultValue={brand?.payroll_start_date?.slice(0, 10)}
            onChange={() => setDirty(true)}
            clearable
            placeholder="Belum dimulai"
            aria-invalid={errors.payroll_start_date ? true : undefined}
          />
          {errors.payroll_start_date ? <FieldError>{errors.payroll_start_date}</FieldError> : <FieldHint>Opsional. Awal periode pertama.</FieldHint>}
        </div>
        {brand && (
          <SelectField
            label="Status"
            name="status"
            defaultValue={brand.status}
            options={[
              { value: "active", label: "Aktif" },
              { value: "inactive", label: "Nonaktif" },
            ]}
          />
        )}
        <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm text-body transition-colors hover:bg-muted/40 has-checked:border-primary/50 has-checked:bg-primary/5 sm:col-span-2">
          <input type="checkbox" name="is_obs" defaultChecked={brand?.is_obs} className="size-4 accent-primary" />
          <span>
            <span className="block font-medium text-foreground">Brand OBS</span>
            <span className="block text-xs text-muted-foreground">Live brand ini memakai OBS.</span>
          </span>
        </label>
      </form>
    </Dialog>
  );
}
