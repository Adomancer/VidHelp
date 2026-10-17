import ReportReview from "@/components/ReportReview";
import PageHeader from "@/components/PageHeader";

export default function AdminReportsPage() {
  return (
    // On laptops the page fills the screen under the header (3.5rem, plus p-6 / 2xl:p-8 around it) and the list scrolls inside
    <div className="flex flex-col gap-6 lg:h-[calc(100svh-6.5rem)] lg:min-h-[34rem] 2xl:h-[calc(100svh-7.5rem)]">
      <PageHeader
        title="Laporan live"
        description="Laporan yang sesuai jadwal disetujui otomatis. Yang ada di sini perlu keputusan: setujui (bisa dengan jam yang dikoreksi) atau tolak."
      />
      <ReportReview className="lg:min-h-0 lg:flex-1" />
    </div>
  );
}
