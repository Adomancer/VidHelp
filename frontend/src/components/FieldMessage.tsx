import { CircleAlert } from "lucide-react";

/** Validation message under a field. */
export function FieldError({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-destructive">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Helper text under a field. */
export function FieldHint({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {children}
    </p>
  );
}
