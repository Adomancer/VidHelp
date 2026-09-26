export default function OperatorDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Operator Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Today&apos;s Schedules</p>
          <p className="text-3xl font-bold text-white mt-1">—</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Active Hosts</p>
          <p className="text-3xl font-bold text-green-400 mt-1">—</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Pending Backups</p>
          <p className="text-3xl font-bold text-orange-400 mt-1">—</p>
        </div>
      </div>
    </div>
  );
}
