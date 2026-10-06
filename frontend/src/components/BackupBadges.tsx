import type { BackupStatus, LetterStatus } from "@/lib/api";

const statusStyles: Record<BackupStatus, [string, string]> = {
  open: ["Mencari pengganti", "bg-blue-500/15 text-info"],
  pending: ["Menunggu keputusan admin", "bg-yellow-500/15 text-warning"],
  filled: ["Sudah ada pengganti", "bg-green-500/15 text-success"],
  cancelled: ["Dibatalkan", "bg-surface-3 text-body"],
  rejected: ["Ditolak", "bg-red-500/15 text-danger"],
};

export function BackupStatusBadge({ status }: { status: BackupStatus }) {
  const [label, style] = statusStyles[status];
  return <span className={`px-2 py-0.5 rounded-md text-xs ${style}`}>{label}</span>;
}

/** Who may apply: everyone, or only the hosts the requester named. */
export function RequestTypeBadge({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return <span className="px-2 py-0.5 rounded-md text-xs bg-primary/15 text-accent">Diminta ke: {names.join(", ")}</span>;
}

const letterStyles: Partial<Record<LetterStatus, [string, string]>> = {
  uploaded: ["Surat sakit sudah diunggah", "text-success"],
  due: ["Perlu surat sakit", "text-warning"],
  late: ["Surat sakit terlambat", "text-danger"],
};

export function LetterBadge({ status }: { status: LetterStatus }) {
  const entry = letterStyles[status];
  if (!entry) return null;
  return <span className={`text-xs ${entry[1]}`}>{entry[0]}</span>;
}

export const reasonLabels = { sick: "Sakit", permit: "Izin", other: "Lainnya" } as const;
