import type { SlotBackupMarker } from "@/lib/api";

/** One line under a slot saying what happens to it on that date because of a backup. */
export default function BackupMarker({ marker, mine = false }: { marker: SlotBackupMarker; mine?: boolean }) {
  if (marker.status === "filled") {
    return (
      <span className="block text-xs text-success">
        {mine ? "Kamu libur · " : "↳ "}digantikan {marker.filler_name}
      </span>
    );
  }

  return (
    <span className={`block text-xs ${marker.status === "open" ? "text-info" : "text-warning"}`}>
      {marker.status === "open" ? "Mencari backup" : "Backup diajukan"}
    </span>
  );
}

/** The marker for a slot on a given date, if any. */
export function markerFor(markers: SlotBackupMarker[] | undefined, slotId: string, date: string) {
  return markers?.find((marker) => marker.slot_id === slotId && marker.backup_date === date);
}
