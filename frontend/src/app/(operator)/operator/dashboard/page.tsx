export default function OperatorDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Dashboard Operator</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Jadwal Hari Ini</p>
          <p className="text-3xl font-bold text-white mt-1">—</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Host Aktif</p>
          <p className="text-3xl font-bold text-green-400 mt-1">—</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Backup Tertunda</p>
          <p className="text-3xl font-bold text-orange-400 mt-1">—</p>
        </div>
      </div>
    </div>
  );
}
