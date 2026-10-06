/** Indonesian labels for status values that come straight from the API. */
const STATUS_LABELS: Record<string, string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  pending: "Menunggu",
  archived: "Diarsipkan",
  banned: "Diblokir",
};

/** "active" → "Aktif"; unknown values are shown as they are. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  operator: "Operator",
  finance: "Finance",
  host: "Host",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
