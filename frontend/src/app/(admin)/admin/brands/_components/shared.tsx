"use client";

import { type BrandSummary } from "@/lib/api";
import { toDateInput } from "@/lib/format";
import { htmlToText } from "@/lib/richText";

export const TOAST_MS = 2200;

const includes = (text: string | null | undefined, query: string) => Boolean(text && query && text.toLowerCase().includes(query.toLowerCase()));

/** Why a brand matches the search: in its name or leader, or only in its product knowledge. */
export function searchMatch(brand: BrandSummary, query: string): "none" | "direct" | "knowledge" {
  if (!query) return "direct";
  if (includes(brand.name, query) || includes(brand.leader?.name, query)) return "direct";
  return includes(brand.product_knowledge && htmlToText(brand.product_knowledge), query) ? "knowledge" : "none";
}

/** "Berjalan hari ke-5", "Mulai 3 hari lagi" or "Belum dimulai". */
export function payrollState(start: string | null | undefined): string {
  if (!start) return "Belum dimulai";
  const day = 86_400_000;
  const diff = Math.round((new Date(`${start.slice(0, 10)}T00:00`).getTime() - new Date(`${toDateInput()}T00:00`).getTime()) / day);
  return diff > 0 ? `Mulai ${diff} hari lagi` : `Berjalan hari ke-${1 - diff}`;
}
