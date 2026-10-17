"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { errorMessage, payrollApi, type FinanceReportRange } from "@/lib/api";
import { formatDate, toDateInput } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import DatePicker, { MonthPicker, parseDateInput } from "./DatePicker";
import Dialog from "./Dialog";
import FormAlert from "./FormAlert";
import SearchableSelect from "./SearchableSelect";
import { NativeSelect } from "./SelectField";
import { notify } from "./Toast";

const RANGES = [
  ["day", "Harian"],
  ["week", "Mingguan"],
  ["month", "Bulanan"],
  ["year", "Tahunan"],
  ["all", "Semua"],
  ["custom", "Rentang"],
] as const;

const SHEETS = ["Ringkasan", "Rekap per host", "Sesi live", "Periode pembayaran", "Slip gaji", "Kasbon", "Cicilan kasbon"];

/** Monday and Sunday of the week `date` (YYYY-MM-DD) falls in. */
function weekOf(date: string): [string, string] {
  const day = parseDateInput(date) ?? new Date();
  const monday = new Date(day);
  monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return [toDateInput(monday), toDateInput(sunday)];
}

/**
 * Download the finance report (Excel, several sheets) for a day, week, month, year, a custom
 * range or everything, for one brand or all.
 */
export default function FinanceReportDialog({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const today = toDateInput();
  const brands = useApiData("payroll-brands", () => payrollApi.brands(token));
  const [range, setRange] = useState<FinanceReportRange>("month");
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [brandId, setBrandId] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anchor = range === "month" ? `${month}-01` : range === "year" ? `${year}-01-01` : date;
  const invalid = range === "custom" && (!from || !to || to < from);
  const [weekStart, weekEnd] = weekOf(date);
  const covers: Record<FinanceReportRange, string> = {
    day: formatDate(date),
    week: `${formatDate(weekStart)} – ${formatDate(weekEnd)}`,
    month: new Date(`${month}-01T00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
    year: `Tahun ${year}`,
    all: "Semua data sejak awal",
    custom: invalid ? "Tanggal akhir harus setelah tanggal mulai" : `${formatDate(from)} – ${formatDate(to)}`,
  };
  const years = Array.from({ length: 6 }, (_, i) => String(Number(today.slice(0, 4)) - i));

  async function download() {
    setDownloading(true);
    setError(null);
    try {
      await payrollApi.report(token, {
        range,
        date: range === "all" || range === "custom" ? undefined : anchor,
        from: range === "custom" ? from : undefined,
        to: range === "custom" ? to : undefined,
        brand_id: brandId || undefined,
      });
      notify({ text: "Laporan keuangan diunduh" });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog
      title="Unduh laporan keuangan"
      description="File Excel berisi beberapa sheet, siap dibaca dan dicetak."
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" onClick={download} disabled={downloading || invalid}>
            <FileSpreadsheet aria-hidden="true" />
            {downloading ? "Menyiapkan…" : "Unduh Excel"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Rentang waktu</legend>
          <div role="radiogroup" aria-label="Rentang waktu" className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted p-1">
            {RANGES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={range === value}
                onClick={() => setRange(value)}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  range === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {(range === "day" || range === "week") && (
          <div className="space-y-1.5">
            <Label htmlFor="report-date">{range === "day" ? "Tanggal" : "Pilih satu hari di minggu itu"}</Label>
            <DatePicker id="report-date" value={date} onChange={setDate} className="sm:w-56" />
          </div>
        )}
        {range === "month" && (
          <div className="space-y-1.5">
            <Label>Bulan</Label>
            <MonthPicker value={month} onChange={setMonth} aria-label="Bulan" className="sm:w-56" />
          </div>
        )}
        {range === "year" && (
          <div className="space-y-1.5">
            <Label htmlFor="report-year">Tahun</Label>
            <NativeSelect id="report-year" value={year} onChange={(event) => setYear(event.target.value)} wrapperClassName="sm:w-40">
              {years.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {range === "custom" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="report-from">Dari</Label>
              <DatePicker id="report-from" value={from} onChange={setFrom} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-to">Sampai</Label>
              <DatePicker id="report-to" value={to} min={from} onChange={setTo} />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="report-brand">Brand</Label>
          {/* Over a hundred brands: type to find one ("all" stands for every brand) */}
          <SearchableSelect
            id="report-brand"
            value={brandId || "all"}
            onChange={(value) => setBrandId(value === "all" ? "" : value)}
            options={[{ value: "all", label: "Semua brand" }, ...(brands.data?.brands.map((brand) => ({ value: brand.id, label: brand.name })) ?? [])]}
            className="sm:w-72"
          />
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className={invalid ? "font-medium text-destructive" : "font-medium text-foreground"}>{covers[range]}</p>
          <p className="mt-1 text-xs text-muted-foreground">Isi: {SHEETS.join(" · ")}.</p>
        </div>
      </div>
    </Dialog>
  );
}
