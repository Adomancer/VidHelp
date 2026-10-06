"use client";

import { useState } from "react";
import Link from "next/link";
import { authApi } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import FormAlert from "./FormAlert";
import GoogleButton from "./GoogleButton";
import { Divider } from "./LoginForm";
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
      <div className="space-y-4 text-center">
        <FormAlert tone="warning">{done}</FormAlert>
        <Link href="/login" className="inline-block text-sm text-accent hover:text-heading">
          Kembali ke halaman masuk
        </Link>
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
        <TextField label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
        <TextField label="Kata sandi" name="password" type="password" autoComplete="new-password" minLength={8} required error={errors.password} />
        <TextField label="Ulangi kata sandi" name="password_confirmation" type="password" autoComplete="new-password" required />

        <SubmitButton loading={loading}>Buat akun</SubmitButton>
      </form>
    </div>
  );
}
