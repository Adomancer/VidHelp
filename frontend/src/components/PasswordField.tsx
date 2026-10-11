"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, FieldHint } from "./FieldMessage";

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  name: string;
  error?: string;
  hint?: React.ReactNode;
  /** Something next to the label, e.g. a "forgot password" link. */
  labelAside?: React.ReactNode;
}

/** A password input with a show/hide button. */
export default function PasswordField({ label, name, error, hint, labelAside, id, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const fieldId = id ?? name;
  const messageId = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={fieldId}>{label}</Label>
        {labelAside}
      </div>
      <div className="relative">
        <Input
          id={fieldId}
          name={name}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          className="pr-10"
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
          aria-pressed={visible}
          className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:size-7"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      {error ? <FieldError id={messageId}>{error}</FieldError> : <FieldHint id={messageId}>{hint}</FieldHint>}
    </div>
  );
}
