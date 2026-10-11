"use client";

import { useId } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { FieldError, FieldHint } from "./FieldMessage";

interface OtpFieldProps {
  label: string;
  /** The form field; it carries the 6 digits. */
  name: string;
  error?: string;
  hint?: React.ReactNode;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Called once all 6 digits are in (e.g. to submit the form). */
  onComplete?: (code: string) => void;
}

/** Six boxes for an authenticator code; pasting a whole code fills them all. */
export default function OtpField({ label, name, error, hint, autoFocus, disabled, onComplete }: OtpFieldProps) {
  const id = useId();
  const slot = "size-11 bg-card text-base font-medium tabular-nums md:size-10";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <InputOTP
        id={id}
        name={name}
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        disabled={disabled}
        onComplete={onComplete}
        aria-invalid={error ? true : undefined}
      >
        <InputOTPGroup>
          <InputOTPSlot index={0} className={slot} aria-invalid={error ? true : undefined} />
          <InputOTPSlot index={1} className={slot} aria-invalid={error ? true : undefined} />
          <InputOTPSlot index={2} className={slot} aria-invalid={error ? true : undefined} />
        </InputOTPGroup>
        <InputOTPSeparator className="mx-1 text-faint" />
        <InputOTPGroup>
          <InputOTPSlot index={3} className={slot} aria-invalid={error ? true : undefined} />
          <InputOTPSlot index={4} className={slot} aria-invalid={error ? true : undefined} />
          <InputOTPSlot index={5} className={slot} aria-invalid={error ? true : undefined} />
        </InputOTPGroup>
      </InputOTP>
      {error ? <FieldError>{error}</FieldError> : <FieldHint>{hint}</FieldHint>}
    </div>
  );
}
