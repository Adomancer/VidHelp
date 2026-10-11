import ScheduleBoard from "@/components/ScheduleBoard";
import PageHeader from "@/components/PageHeader";

export default function OperatorSchedulesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Jadwal"
        description="Slot mingguan per brand. Hanya satu host yang live per brand pada satu waktu; host tidak bisa berada di dua tempat sekaligus."
      />
      <ScheduleBoard />
    </div>
  );
}
