import ScheduleBoard from "@/components/ScheduleBoard";

export default function OperatorSchedulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-heading">Jadwal</h1>
        <p className="text-sm text-muted mt-1">Slot mingguan per brand. Hanya satu host yang live per brand pada satu waktu; host tidak dapat berada di dua tempat sekaligus.</p>
      </div>
      <ScheduleBoard />
    </div>
  );
}
