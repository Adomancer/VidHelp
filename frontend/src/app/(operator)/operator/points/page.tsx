import PointsDesk from "@/components/PointsDesk";

export default function OperatorPointsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Poin &amp; SP</h1>
        <p className="text-sm text-gray-400 mt-1">Catat pelanggaran dan komplain brand. Hanya admin yang bisa membatalkan catatan yang salah.</p>
      </div>
      <PointsDesk />
    </div>
  );
}
