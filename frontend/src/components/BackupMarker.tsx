import type { SlotBackupMarker } from "@/lib/api";

/** One line under a slot saying what happens to it on that date because of a backup. */
export default function BackupMarker({ marker, mine = false }: { marker: SlotBackupMarker; mine?: boolean }) {
  if (marker.status === "filled") {
    return (
      <span className="block text-xs text-green-300">
        {mine ? "You're off · " : "↳ "}covered by {marker.filler_name}
      </span>
    );
  }

  return (
    <span className={`block text-xs ${marker.status === "open" ? "text-blue-200" : "text-yellow-200"}`}>
      {marker.status === "open" ? "Looking for a backup" : "Backup requested"}
    </span>
  );
}

/** The marker for a slot on a given date, if any. */
export function markerFor(markers: SlotBackupMarker[] | undefined, slotId: string, date: string) {
  return markers?.find((marker) => marker.slot_id === slotId && marker.backup_date === date);
}
