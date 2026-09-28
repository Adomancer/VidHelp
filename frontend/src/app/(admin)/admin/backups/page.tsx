import BackupDesk from "@/components/BackupDesk";

export default function AdminBackupsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Backups</h1>
        <p className="text-sm text-gray-400 mt-1">
          Approve absence requests, then pick who covers them. Unreviewed requests open by themselves after 30 minutes,
          and the best applicant is picked 30 minutes before the session if nobody chose.
        </p>
      </div>
      <BackupDesk />
    </div>
  );
}
