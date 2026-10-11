import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { selectClass, selectSmClass } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { FieldError, FieldHint } from "./FieldMessage";

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  name: string;
  error?: string;
  hint?: React.ReactNode;
  options: { value: string; label: string }[];
}

/** Labelled native select (works with FormData and the phone's own picker); shows its error underneath. */
export default function SelectField({ label, name, error, hint, options, id, ...props }: SelectFieldProps) {
  const fieldId = id ?? name;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <NativeSelect id={fieldId} name={name} aria-invalid={error ? true : undefined} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {error ? <FieldError>{error}</FieldError> : <FieldHint>{hint}</FieldHint>}
    </div>
  );
}

interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Compact, for tables and inline rows. */
  small?: boolean;
  /** Classes for the wrapper (width, flex); `className` styles the select itself. */
  wrapperClassName?: string;
}

/** A styled native <select> with a chevron, for filters and inline forms. */
export function NativeSelect({ className, wrapperClassName, small = false, children, ...props }: NativeSelectProps) {
  return (
    <div className={cn("relative", wrapperClassName)}>
      <select className={cn(small ? selectSmClass : selectClass, className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground", small ? "right-2.5 size-3.5" : "right-3 size-4")}
        aria-hidden="true"
      />
    </div>
  );
}
