import ScheduleBoard from "@/components/ScheduleBoard";

export default function AdminSchedulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-heading">Jadwal</h1>
        <p className="text-sm text-muted mt-1">Siapa live, kapan, di brand mana. Klik slot untuk melihat detail, mengatur backup, atau menguncinya agar Operator tidak bisa mengubahnya.</p>
      </div>
      <ScheduleBoard isAdmin />
    </div>
  );
}
