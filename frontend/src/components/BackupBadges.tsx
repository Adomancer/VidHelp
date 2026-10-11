import type { BackupStatus, LetterStatus } from "@/lib/api";
import StatusBadge, { toneText, type Tone } from "./StatusBadge";

const statusStyles: Record<BackupStatus, [string, Tone]> = {
  open: ["Mencari pengganti", "info"],
  pending: ["Menunggu keputusan admin", "warning"],
  filled: ["Sudah ada pengganti", "success"],
  cancelled: ["Dibatalkan", "neutral"],
  rejected: ["Ditolak", "danger"],
};

export function BackupStatusBadge({ status }: { status: BackupStatus }) {
  const [label, tone] = statusStyles[status];
  return (
    <StatusBadge tone={tone} dot>
      {label}
    </StatusBadge>
  );
}

/** Who may apply: everyone, or only the hosts the requester named. */
export function RequestTypeBadge({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return <StatusBadge tone="brand">Diminta ke: {names.join(", ")}</StatusBadge>;
}

const letterStyles: Partial<Record<LetterStatus, [string, Tone]>> = {
  uploaded: ["Surat sakit sudah diunggah", "success"],
  due: ["Perlu surat sakit", "warning"],
  late: ["Surat sakit terlambat", "danger"],
};

export function LetterBadge({ status }: { status: LetterStatus }) {
  const entry = letterStyles[status];
  if (!entry) return null;
  return <span className={`text-xs font-medium ${toneText[entry[1]]}`}>{entry[0]}</span>;
}

export const reasonLabels = { sick: "Sakit", permit: "Izin", other: "Lainnya" } as const;
