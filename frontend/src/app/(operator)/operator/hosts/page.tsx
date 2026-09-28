import HostTable from "@/components/HostTable";

export default function OperatorHostsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Hosts</h1>
        <p className="text-sm text-gray-400 mt-1">Assign hosts to brands and pick each brand&apos;s leader (★).</p>
      </div>
      <HostTable editableBrands />
    </div>
  );
}
