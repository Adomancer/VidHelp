import { formatRupiah } from "./format";

/**
 * Labels for the live report numbers. Placeholder until the agency's template
 * arrives; keys must match config('vidhelp.report_metrics') in the backend.
 */
export const METRIC_LABELS: Record<string, { label: string; step?: number; format?: (value: number) => string }> = {
  gmv: { label: "GMV (Rp)", step: 1000, format: formatRupiah },
  orders: { label: "Orders" },
  viewers: { label: "Viewers" },
};

export function metricLabel(key: string): string {
  return METRIC_LABELS[key]?.label ?? key;
}

export function formatMetric(key: string, value: number): string {
  return METRIC_LABELS[key]?.format?.(value) ?? value.toLocaleString("id-ID");
}

export const FLAG_REASONS: Record<string, string> = {
  late_report: "Report sent after the 24h deadline",
  no_check_out: "No check-out",
  more_than_scheduled: "More hours than scheduled",
  less_than_scheduled: "Fewer hours than scheduled",
  more_than_attended: "More hours than checked in",
};
