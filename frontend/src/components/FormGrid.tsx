import { cn } from "@/lib/utils";

/** Responsive form layout: 1 column on mobile, 2 columns from `sm` up. */
export function FormGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", className)}>{children}</div>;
}

/** Spans all columns inside `FormGrid`. */
export function FormFieldFull({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("sm:col-span-full", className)}>{children}</div>;
}
