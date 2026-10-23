"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { authApi } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { Button } from "@/components/ui/button";
import FormAlert from "./FormAlert";
import GoogleButton from "./GoogleButton";
import { Divider } from "./LoginForm";
import PasswordField from "./PasswordField";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

export default function RegisterForm() {
  const [done, setDone] = useState<string | null>(null);
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      authApi.register({
        name: formValue(data, "name"),
        email: formValue(data, "email"),
        password: formValue(data, "password"),
        password_confirmation: formValue(data, "password_confirmation"),
      }),
    ({ message }) => setDone(message)
  );

  if (done) {
    return (
      <div className="space-y-5 rounded-xl border border-border bg-card p-6 text-center shadow-xs">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
          <MailCheck className="size-5" aria-hidden="true" />
        </span>
        <p className="text-sm text-body">{done}</p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Kembali ke halaman masuk</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GoogleButton label="Daftar dengan Google" />
      <Divider />

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <TextField label="Nama lengkap" name="name" autoComplete="name" required error={errors.name} />
        <TextField label="Email" name="email" type="email" autoComplete="email" placeholder="nama@email.com" required error={errors.email} />
        <PasswordField
          label="Kata sandi"
          name="password"
          autoComplete="new-password"
          minLength={8}
          hint="Minimal 8 karakter."
          required
          error={errors.password}
        />
        <PasswordField label="Ulangi kata sandi" name="password_confirmation" autoComplete="new-password" required />

        <SubmitButton loading={loading}>Buat akun</SubmitButton>
      </form>
    </div>
  );
}
