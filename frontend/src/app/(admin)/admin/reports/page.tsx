import ReportReview from "@/components/ReportReview";

export default function AdminReportsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Live Reports</h1>
        <p className="text-sm text-gray-400 mt-1">
          Reports that match the schedule are approved automatically. The ones here need a decision: approve (optionally
          with corrected hours) or reject.
        </p>
      </div>
      <ReportReview />
    </div>
  );
}
