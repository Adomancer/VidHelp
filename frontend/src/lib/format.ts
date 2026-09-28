const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

/** 15000 → "Rp 15.000" */
export function formatRupiah(value: string | number): string {
  return rupiah.format(Number(value));
}

/** "2026-09-28" → "28 Sep 2026" */
export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** 13 → "1 yr 1 mo" */
export function formatTenure(joinDate: string): string {
  const joined = new Date(joinDate);
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - joined.getFullYear()) * 12 + now.getMonth() - joined.getMonth() - (now.getDate() < joined.getDate() ? 1 : 0));
  const years = Math.floor(months / 12);

  if (years === 0) return `${months} mo`;
  return months % 12 === 0 ? `${years} yr` : `${years} yr ${months % 12} mo`;
}
