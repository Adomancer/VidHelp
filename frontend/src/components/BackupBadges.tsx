import type { BackupStatus, LetterStatus } from "@/lib/api";

const statusStyles: Record<BackupStatus, [string, string]> = {
  open: ["Looking for a cover", "bg-blue-500/15 text-blue-200"],
  pending: ["Waiting for admin decision", "bg-yellow-500/15 text-yellow-200"],
  filled: ["Covered", "bg-green-500/15 text-green-300"],
  cancelled: ["Cancelled", "bg-slate-700 text-gray-300"],
  rejected: ["Rejected", "bg-red-500/15 text-red-300"],
};

export function BackupStatusBadge({ status }: { status: BackupStatus }) {
  const [label, style] = statusStyles[status];
  return <span className={`px-2 py-0.5 rounded-md text-xs ${style}`}>{label}</span>;
}

/** Who may apply: everyone, or only the hosts the requester named. */
export function RequestTypeBadge({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return <span className="px-2 py-0.5 rounded-md text-xs bg-purple-500/15 text-purple-200">Asked: {names.join(", ")}</span>;
}

const letterStyles: Partial<Record<LetterStatus, [string, string]>> = {
  uploaded: ["Sick letter uploaded", "text-green-300"],
  due: ["Sick letter needed", "text-yellow-200"],
  late: ["Sick letter late", "text-red-300"],
};

export function LetterBadge({ status }: { status: LetterStatus }) {
  const entry = letterStyles[status];
  if (!entry) return null;
  return <span className={`text-xs ${entry[1]}`}>{entry[0]}</span>;
}

export const reasonLabels = { sick: "Sick", permit: "Permission", other: "Other" } as const;
