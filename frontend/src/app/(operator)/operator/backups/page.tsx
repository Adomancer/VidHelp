import BackupDesk from "@/components/BackupDesk";
import PageHeader from "@/components/PageHeader";
import BackupTimingNote from "@/components/BackupTimingNote";

export default function OperatorBackupsPage() {
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Backup"
        description={<BackupTimingNote />}
      />
      <BackupDesk />
    </div>
  );
}
