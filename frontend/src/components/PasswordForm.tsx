"use client";

import { useState } from "react";
import { authApi } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import FormAlert from "./FormAlert";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

/** Change password, or set a first one for accounts created with Google. */
export default function PasswordForm() {
  const { user, token, setUser } = useAuth();
  const [saved, setSaved] = useState<string | null>(null);

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      authApi.changePassword(token, {
        current_password: user.has_password ? formValue(data, "current_password") : undefined,
        password: formValue(data, "password"),
        password_confirmation: formValue(data, "password_confirmation"),
      }),
    ({ message }, form) => {
      form.reset();
      setSaved(message);
      setUser({ ...user, has_password: true });
    }
  );

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div>
        <h2 className="text-white font-medium">{user.has_password ? "Change password" : "Set a password"}</h2>
        {!user.has_password && (
          <p className="text-sm text-gray-400 mt-1">
            You sign in with Google. Set a password if you also want to sign in with your email.
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {saved && <FormAlert tone="success">{saved}</FormAlert>}

        {user.has_password && (
          <TextField label="Current password" name="current_password" type="password" autoComplete="current-password" required error={errors.current_password} />
        )}
        <TextField label="New password" name="password" type="password" autoComplete="new-password" minLength={8} required error={errors.password} />
        <TextField label="Confirm new password" name="password_confirmation" type="password" autoComplete="new-password" required />

        <SubmitButton loading={loading}>Save password</SubmitButton>
      </form>
    </section>
  );
}
