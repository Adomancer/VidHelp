import ReportReview from "@/components/ReportReview";
import PageHeader from "@/components/PageHeader";

export default function OperatorReportsPage() {
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Laporan live"
        description="Laporan yang sesuai jadwal disetujui otomatis. Yang ada di sini perlu keputusan: setujui (bisa dengan jam yang dikoreksi) atau tolak."
      />
      <ReportReview />
    </div>
  );
}
