import { redirect } from "next/navigation";

/** Old link: finance now works in the admin panel. */
export default function FinanceSecurityRedirect() {
  redirect("/admin/security");
}
