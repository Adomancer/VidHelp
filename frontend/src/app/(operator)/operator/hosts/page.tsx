import HostTable from "@/components/HostTable";

export default function OperatorHostsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Host</h1>
        <p className="text-sm text-gray-400 mt-1">Tugaskan host ke brand dan pilih leader tiap brand (★).</p>
      </div>
      <HostTable editableBrands />
    </div>
  );
}
