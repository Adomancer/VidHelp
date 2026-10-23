import type { HostProfile } from "./api";
import { formValue } from "./useApiForm";

const digits = (value: string | null) => (value ?? "").replace(/\D/g, "");

/**
 * What a host edited in the "Data pribadi" form: only those fields are sent. Sending an unchanged one
 * would drop it from a pending request (the server treats "same as saved" as "never mind"), e.g. a
 * phone change sent earlier. Compared as the fields show them: phone fields keep digits only.
 */
export function changedPersonalFields(form: FormData, saved: { name: string; host: Pick<HostProfile, "phone" | "guardian_phone"> }) {
  const current = { name: saved.name, phone: digits(saved.host.phone), guardian_phone: digits(saved.host.guardian_phone) };
  const changed = (Object.keys(current) as (keyof typeof current)[])
    .map((field) => [field, formValue(form, field).trim()] as const)
    .filter(([field, value]) => value !== current[field]);
  return Object.fromEntries(changed.map(([field, value]) => [field, value || null])) as {
    name?: string | null;
    phone?: string | null;
    guardian_phone?: string | null;
  };
}
