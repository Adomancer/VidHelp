import PointsDesk from "@/components/PointsDesk";
import ViolationTypesEditor from "@/components/ViolationTypesEditor";

export default function AdminPointsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Points &amp; SP</h1>
        <p className="text-sm text-gray-400 mt-1">
          Record violations, cancel wrong entries, and issue or cancel warning letters by hand.
        </p>
      </div>
      <PointsDesk isAdmin />
      <ViolationTypesEditor />
    </div>
  );
}
