"use client";

import { useState } from "react";
import { eventApi, operatorApi, type EventInput, type SpecialEvent } from "@/lib/api";
import { toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { inputClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "../AuthProvider";
import DatePicker from "../DatePicker";
import Dialog from "../Dialog";
import FormAlert from "../FormAlert";
import { NativeSelect } from "../SelectField";
import { TALL } from "./shared";

/** Checks before sending, so obvious mistakes show at once next to their field. */
function validate(data: FormData): Record<string, string> {
  const errors: Record<string, string> = {};
  const minutes = Number(formValue(data, "block_hours") || 0) * 60 + Number(formValue(data, "block_extra_minutes") || 0);
  const start = formValue(data, "start_date");
  const end = formValue(data, "end_date");

  if (!formValue(data, "name").trim()) errors.name = "Nama event wajib diisi.";
  if (!Number.isFinite(minutes) || minutes < 15) errors.block_minutes = "Durasi blok minimal 15 menit.";
  else if (minutes > 720) errors.block_minutes = "Durasi blok maksimal 12 jam.";
  if (!start) errors.start_date = "Pilih hari pertama.";
  if (!end) errors.end_date = "Pilih hari terakhir.";
  else if (start && end < start) errors.end_date = "Hari terakhir tidak boleh sebelum hari pertama.";
  if (formValue(data, "daily_start_time") === formValue(data, "daily_end_time")) errors.daily_end_time = "Jam tutup harus beda dengan jam buka.";
  const max = Number(formValue(data, "max_slots_per_host"));
  if (!Number.isInteger(max) || max < 1 || max > 100) errors.max_slots_per_host = "Isi angka 1 sampai 100.";

  return errors;
}

/** New event, or with `event` the edit form: everything but the brand can change. */
export function EventForm({ event, onDone, onCancel }: { event?: SpecialEvent; onDone: (message: string, id: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const today = toDateInput();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const [checks, setChecks] = useState<Record<string, string>>({});
  const input = cn(inputClass, TALL, "tabular-nums");

  const {
    loading,
    errors: serverErrors,
    error,
    handleSubmit,
  } = useApiForm(
    (data) => {
      const payload: Omit<EventInput, "brand_id"> = {
        name: formValue(data, "name").trim(),
        start_date: formValue(data, "start_date"),
        end_date: formValue(data, "end_date"),
        daily_start_time: formValue(data, "daily_start_time"),
        daily_end_time: formValue(data, "daily_end_time"),
        block_minutes: Number(formValue(data, "block_hours") || 0) * 60 + Number(formValue(data, "block_extra_minutes") || 0),
        open_full_schedule: data.get("open_full_schedule") === "on",
        max_slots_per_host: Number(formValue(data, "max_slots_per_host")),
      };
      return event ? eventApi.update(token, event.id, payload) : eventApi.create(token, { ...payload, brand_id: formValue(data, "brand_id") });
    },
    ({ message, event: saved }) => onDone(message, saved.id),
    ["block_minutes"]
  );
  const errors = { ...serverErrors, ...checks };

  function submit(submitted: React.FormEvent<HTMLFormElement>) {
    const found = validate(new FormData(submitted.currentTarget));
    setChecks(found);
    if (Object.keys(found).length > 0) {
      submitted.preventDefault();
      return;
    }
    void handleSubmit(submitted);
  }

  const field = (label: string, name: string, child: React.ReactNode) => (
    <label className="space-y-1.5">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {child}
      {errors[name] && <span className="block text-sm text-destructive">{errors[name]}</span>}
    </label>
  );

  return (
    <Dialog
      placement="side"
      size="lg"
      closeOnOutsideClick={false}
      title={event ? "Edit event" : "Event baru"}
      description={
        event
          ? "Jadwal boleh diubah selama blok yang sudah diambil host tetap ada. Host brand ini diberi tahu kalau tanggal atau jamnya berubah."
          : "Host dari brand ini mengambil blok, siapa cepat dia dapat. Kamu juga bisa menunjuk host langsung."
      }
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onCancel} className={TALL}>
            Batal
          </Button>
          <Button type="submit" form="event-form" size="lg" disabled={loading} className={TALL}>
            {loading ? "Menyimpan…" : event ? "Simpan perubahan" : "Buat event"}
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {(error || errors.schedule) && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{errors.schedule ?? error}</FormAlert>
          </div>
        )}
        {event ? (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground">Brand</span>
            <p className="flex h-11 items-center rounded-lg border border-border bg-muted/50 px-3 text-sm text-muted-foreground">{event.brand?.name}</p>
            <span className="block text-xs text-muted-foreground">Brand tidak bisa diubah. Hapus dan buat ulang event kalau salah brand.</span>
          </div>
        ) : (
          field(
            "Brand",
            "brand_id",
            <NativeSelect name="brand_id" className={TALL}>
              {brands.data?.brands
                .filter((brand) => brand.status === "active")
                .map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
            </NativeSelect>
          )
        )}
        {field(
          "Nama",
          "name",
          <input
            name="name"
            placeholder="PD 10.10"
            maxLength={100}
            defaultValue={event?.name}
            aria-invalid={errors.name ? true : undefined}
            className={input}
          />
        )}
        {field(
          "Hari pertama",
          "start_date",
          <DatePicker name="start_date" defaultValue={event?.start_date.slice(0, 10) ?? today} min={event ? undefined : today} />
        )}
        {field(
          "Hari terakhir",
          "end_date",
          <DatePicker name="end_date" defaultValue={event?.end_date.slice(0, 10) ?? today} min={event ? undefined : today} />
        )}
        {field(
          "Jam buka",
          "daily_start_time",
          <input name="daily_start_time" type="time" defaultValue={event?.daily_start_time ?? "10:00"} className={input} />
        )}
        {field(
          "Jam tutup (boleh lewat tengah malam)",
          "daily_end_time",
          <input
            name="daily_end_time"
            type="time"
            defaultValue={event?.daily_end_time ?? "22:00"}
            aria-invalid={errors.daily_end_time ? true : undefined}
            className={input}
          />
        )}
        {field(
          "Durasi blok",
          "block_minutes",
          <div className="flex items-center gap-2">
            <input
              name="block_hours"
              type="number"
              min={0}
              max={12}
              defaultValue={event ? Math.floor(event.block_minutes / 60) : 2}
              aria-label="Jam per blok"
              aria-invalid={errors.block_minutes ? true : undefined}
              className={input}
            />
            <span className="text-sm text-muted-foreground">jam</span>
            <input
              name="block_extra_minutes"
              type="number"
              min={0}
              max={59}
              step={15}
              defaultValue={event ? event.block_minutes % 60 : 0}
              aria-label="Menit per blok"
              aria-invalid={errors.block_minutes ? true : undefined}
              className={input}
            />
            <span className="text-sm text-muted-foreground">menit</span>
          </div>
        )}
        {field(
          "Maks blok per host",
          "max_slots_per_host",
          <input
            name="max_slots_per_host"
            type="number"
            min={1}
            max={100}
            defaultValue={event?.max_slots_per_host ?? 3}
            aria-invalid={errors.max_slots_per_host ? true : undefined}
            className={input}
          />
        )}
        <label className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-body sm:col-span-2">
          <input type="checkbox" name="open_full_schedule" defaultChecked={event?.open_full_schedule} className="size-4 accent-primary" />
          Gantikan jadwal reguler brand di hari-hari ini <span className="text-muted-foreground">(&quot;jadwal dibuka kosong&quot;)</span>
        </label>
      </form>
    </Dialog>
  );
}
