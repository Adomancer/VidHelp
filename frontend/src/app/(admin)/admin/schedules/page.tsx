import ScheduleBoard from "@/components/ScheduleBoard";

export default function AdminSchedulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Schedules</h1>
        <p className="text-sm text-gray-400 mt-1">Open a slot to lock it. Operators can&apos;t change or remove locked slots.</p>
      </div>
      <ScheduleBoard isAdmin />
    </div>
  );
}
