import ReportReview from "@/components/ReportReview";

export default function AdminReportsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-heading">Laporan Live</h1>
        <p className="text-sm text-muted mt-1">
          Laporan yang sesuai jadwal disetujui otomatis. Yang ada di sini perlu keputusan: setujui (bisa
          dengan jam yang dikoreksi) atau tolak.
        </p>
      </div>
      <ReportReview />
    </div>
  );
}
