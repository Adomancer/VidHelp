"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { authApi } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import FormAlert from "./FormAlert";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

export default function ForgotPasswordForm() {
  const [sent, setSent] = useState<string | null>(null);
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => authApi.forgotPassword(formValue(data, "email")),
    ({ message }) => setSent(message)
  );

  if (sent) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-6 text-center shadow-xs">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
          <MailCheck className="size-5" aria-hidden="true" />
        </span>
        <p className="text-sm text-body">{sent}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <TextField label="Email" name="email" type="email" autoComplete="email" placeholder="nama@email.com" required error={errors.email} />
      <SubmitButton loading={loading}>Kirim link reset</SubmitButton>
    </form>
  );
}
