export default function AdminDashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Admin Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Stat cards — to be implemented */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Total Hosts</p>
          <p className="text-3xl font-bold text-white mt-1">—</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Active Hosts</p>
          <p className="text-3xl font-bold text-green-400 mt-1">—</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Operators</p>
          <p className="text-3xl font-bold text-purple-400 mt-1">—</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <p className="text-sm text-gray-400">Total Revenue</p>
          <p className="text-3xl font-bold text-yellow-400 mt-1">—</p>
        </div>
      </div>
    </div>
  );
}
