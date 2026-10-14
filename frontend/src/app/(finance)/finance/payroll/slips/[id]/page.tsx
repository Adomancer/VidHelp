import { redirect } from "next/navigation";

/** Old link: finance now works in the admin panel. */
export default async function FinanceSlipRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/payroll/slips/${id}`);
}
