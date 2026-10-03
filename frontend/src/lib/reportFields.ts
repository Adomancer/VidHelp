import { formatRupiah } from "./format";

/**
 * Labels for the live report numbers. Placeholder until the agency's template
 * arrives; keys must match config('vidhelp.report_metrics') in the backend.
 */
export const METRIC_LABELS: Record<string, { label: string; step?: number; format?: (value: number) => string }> = {
  gmv: { label: "GMV (Rp)", step: 1000, format: formatRupiah },
  orders: { label: "Pesanan" },
  viewers: { label: "Penonton" },
};

export function metricLabel(key: string): string {
  return METRIC_LABELS[key]?.label ?? key;
}

export function formatMetric(key: string, value: number): string {
  return METRIC_LABELS[key]?.format?.(value) ?? value.toLocaleString("id-ID");
}

export const FLAG_REASONS: Record<string, string> = {
  late_report: "Laporan dikirim lewat batas 24 jam",
  no_check_out: "Tidak check-out",
  more_than_scheduled: "Jam lebih banyak dari jadwal",
  less_than_scheduled: "Jam lebih sedikit dari jadwal",
  more_than_attended: "Jam lebih banyak dari waktu check-in",
};
