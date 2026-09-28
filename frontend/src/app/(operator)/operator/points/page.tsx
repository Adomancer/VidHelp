import PointsDesk from "@/components/PointsDesk";

export default function OperatorPointsPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Points &amp; SP</h1>
        <p className="text-sm text-gray-400 mt-1">Record violations and brand complaints. Only an admin can cancel a wrong entry.</p>
      </div>
      <PointsDesk />
    </div>
  );
}
