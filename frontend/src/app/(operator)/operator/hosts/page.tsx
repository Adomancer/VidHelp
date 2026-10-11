import HostTable from "@/components/HostTable";
import PageHeader from "@/components/PageHeader";

export default function OperatorHostsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Host" description="Tugaskan host ke brand dan pilih leader tiap brand." />
      <HostTable editableBrands />
    </div>
  );
}
