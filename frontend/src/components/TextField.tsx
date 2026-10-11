import type { InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FieldHint } from "./FieldMessage";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
  hint?: React.ReactNode;
}

/** Labelled input with optional helper text; shows its validation error underneath. */
export default function TextField({ label, name, error, hint, id, ...props }: TextFieldProps) {
  const fieldId = id ?? name;
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input id={fieldId} name={name} aria-invalid={error ? true : undefined} aria-describedby={messageId} {...props} />
      {error ? <FieldError id={messageId}>{error}</FieldError> : <FieldHint id={messageId}>{hint}</FieldHint>}
    </div>
  );
}
