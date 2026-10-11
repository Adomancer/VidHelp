import ScheduleBoard from "@/components/ScheduleBoard";
import PageHeader from "@/components/PageHeader";

export default function AdminSchedulesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Jadwal"
        description="Siapa live, kapan, di brand mana. Klik slot untuk melihat detail, mengatur backup, atau menguncinya agar operator tidak bisa mengubahnya."
      />
      <ScheduleBoard isAdmin />
    </div>
  );
}
