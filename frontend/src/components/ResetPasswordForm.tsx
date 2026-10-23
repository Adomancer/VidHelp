"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authApi } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { Button } from "@/components/ui/button";
import FormAlert from "./FormAlert";
import PasswordField from "./PasswordField";
import SubmitButton from "./SubmitButton";

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
    ({ message }) => setDone(message),
    ["email"]
  );

  if (!token || !email) {
    return (
      <div className="space-y-4">
        <FormAlert tone="error">Link reset ini tidak lengkap. Silakan minta link baru.</FormAlert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/forgot-password">Minta link baru</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">{done}</FormAlert>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Ke halaman masuk</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {/* token/email problems (expired link, wrong account) come back on the email field */}
      {errors.email && <FormAlert tone="error">{errors.email}</FormAlert>}

      <p className="text-sm text-body">
        Untuk akun <span className="font-medium text-foreground">{email}</span>
      </p>
      <PasswordField label="Kata sandi baru" name="password" autoComplete="new-password" minLength={8} required error={errors.password} />
      <PasswordField label="Ulangi kata sandi baru" name="password_confirmation" autoComplete="new-password" required />

      <SubmitButton loading={loading}>Atur ulang kata sandi</SubmitButton>
    </form>
  );
}
