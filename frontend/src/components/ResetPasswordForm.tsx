"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authApi } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import FormAlert from "./FormAlert";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

/** Opened from the emailed link: /reset-password?token=...&email=... */
export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const email = searchParams.get("email") ?? "";
  const [done, setDone] = useState<string | null>(null);

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      authApi.resetPassword({
        token,
        email,
        password: formValue(data, "password"),
        password_confirmation: formValue(data, "password_confirmation"),
      }),
    ({ message }) => setDone(message)
  );

  if (!token || !email) {
    return <FormAlert tone="error">This reset link is incomplete. Please request a new one.</FormAlert>;
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <FormAlert tone="success">{done}</FormAlert>
        <Link href="/login" className="inline-block text-sm text-purple-300 hover:text-white">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {/* token/email problems (expired link, wrong account) come back on the email field */}
      {errors.email && <FormAlert tone="error">{errors.email}</FormAlert>}

      <p className="text-sm text-gray-300">
        Setting a new password for <span className="text-white">{email}</span>
      </p>
      <TextField label="New password" name="password" type="password" autoComplete="new-password" minLength={8} required error={errors.password} />
      <TextField label="Confirm new password" name="password_confirmation" type="password" autoComplete="new-password" required />

      <SubmitButton loading={loading}>Reset password</SubmitButton>
    </form>
  );
}
