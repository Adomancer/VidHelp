import PointsDesk from "@/components/PointsDesk";
import PageHeader from "@/components/PageHeader";
import { PointsExportButton } from "@/components/PointsActions";

export default function OperatorPointsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Poin & SP"
        description="Catat pelanggaran dan komplain brand. Hanya admin yang bisa membatalkan catatan yang salah."
        actions={<PointsExportButton />}
      />
      <PointsDesk />
    </div>
  );
}
