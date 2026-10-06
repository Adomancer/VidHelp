import BackupDesk from "@/components/BackupDesk";
import BackupTimingNote from "@/components/BackupTimingNote";

export default function AdminBackupsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-heading">Backup</h1>
        <BackupTimingNote />
      </div>
      <BackupDesk />
    </div>
  );
}
