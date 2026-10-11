"use client";

import { authApi } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
import PasswordField from "./PasswordField";
import SubmitButton from "./SubmitButton";
import { notify } from "./Toast";

/** Change password, or set a first one for accounts created with Google. */
export default function PasswordForm({ id }: { id?: string }) {
  const { user, token, setUser } = useAuth();

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      authApi.changePassword(token, {
        current_password: user.has_password ? formValue(data, "current_password") : undefined,
        password: formValue(data, "password"),
        password_confirmation: formValue(data, "password_confirmation"),
      }),
    ({ message }, form) => {
      form.reset();
      notify({ text: message });
      setUser({ ...user, has_password: true });
    }
  );

  return (
    <Card
      id={id}
      title={user.has_password ? "Ganti kata sandi" : "Buat kata sandi"}
      description={user.has_password ? "Minimal 8 karakter." : "Kamu masuk dengan Google. Buat kata sandi kalau kamu juga mau masuk dengan email."}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        {user.has_password && (
          <PasswordField label="Kata sandi saat ini" name="current_password" autoComplete="current-password" required error={errors.current_password} />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <PasswordField label="Kata sandi baru" name="password" autoComplete="new-password" minLength={8} required error={errors.password} />
          <PasswordField label="Ulangi kata sandi baru" name="password_confirmation" autoComplete="new-password" required />
        </div>

        <div className="flex justify-end">
          <SubmitButton loading={loading} size="default" className="sm:w-auto">
            Simpan kata sandi
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
