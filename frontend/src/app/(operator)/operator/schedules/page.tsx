import ScheduleBoard from "@/components/ScheduleBoard";

export default function OperatorSchedulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Schedules</h1>
        <p className="text-sm text-gray-400 mt-1">Weekly slots per brand. One host live per brand at a time; a host can&apos;t be in two places.</p>
      </div>
      <ScheduleBoard />
    </div>
  );
}
