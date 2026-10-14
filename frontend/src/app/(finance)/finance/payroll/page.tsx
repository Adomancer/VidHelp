import { redirect } from "next/navigation";

/** Old link: finance now works in the admin panel. Keeps ?tab=… and the other filters. */
export default async function FinancePayrollRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value].flat()) if (item !== undefined) params.append(key, item);
  }
  const query = params.toString();
  redirect(`/admin/payroll${query ? `?${query}` : ""}`);
}
