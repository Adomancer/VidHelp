import PayrollDesk from "@/components/PayrollDesk";

export default function AdminPayrollPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Payroll</h1>
        <p className="text-sm text-gray-400 mt-1">
          Every approved live hour lands in its brand&apos;s payment period. When a period ends: request payment (locks hours and rates, gives
          you the brand report), then mark it paid to create salary slips with kasbon deducted.
        </p>
      </div>
      <PayrollDesk />
    </div>
  );
}
