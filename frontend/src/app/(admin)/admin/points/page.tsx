import PointsDesk from "@/components/PointsDesk";
import PageHeader from "@/components/PageHeader";
import { PointsExportButton, ViolationTypesButton } from "@/components/PointsActions";

export default function AdminPointsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Poin & SP"
        description="Catat pelanggaran, batalkan catatan yang salah, serta terbitkan atau batalkan surat peringatan secara manual."
        actions={
          <>
            <ViolationTypesButton />
            <PointsExportButton />
          </>
        }
      />
      <PointsDesk isAdmin />
    </div>
  );
}
