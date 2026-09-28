"use client";

import { useState } from "react";
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

  if (sent) return <FormAlert tone="success">{sent}</FormAlert>;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && <FormAlert tone="error">{error}</FormAlert>}

      <p className="text-sm text-gray-300">
        Enter your email and we&apos;ll send you a link to set a new password. This also works if you
        signed up with Google and never had a password.
      </p>
      <TextField label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />

      <SubmitButton loading={loading}>Send reset link</SubmitButton>
    </form>
  );
}
