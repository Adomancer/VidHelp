export default function OperatorDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-heading mb-6">Dashboard Operator</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-surface border border-stroke rounded-[10px] shadow-card p-6">
          <p className="text-sm text-muted">Jadwal Hari Ini</p>
          <p className="text-3xl font-bold text-heading mt-1">—</p>
        </div>
        <div className="bg-surface border border-stroke rounded-[10px] shadow-card p-6">
          <p className="text-sm text-muted">Host Aktif</p>
          <p className="text-3xl font-bold text-success mt-1">—</p>
        </div>
        <div className="bg-surface border border-stroke rounded-[10px] shadow-card p-6">
          <p className="text-sm text-muted">Backup Tertunda</p>
          <p className="text-3xl font-bold text-warning mt-1">—</p>
        </div>
      </div>
    </div>
  );
}
