"use client";

import { useState } from "react";
import { authApi } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import FormAlert from "@/components/FormAlert";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import UserAvatar from "@/components/UserAvatar";

export default function HostProfilePage() {
  const { user, logout } = useAuth();

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-bold text-white">My Profile</h1>

      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
        <UserAvatar size="w-14 h-14" />
        <div className="min-w-0">
          <p className="text-white font-medium truncate">{user.name}</p>
          <p className="text-sm text-gray-400 truncate">{user.email}</p>
          <p className="text-xs text-purple-300 mt-1 capitalize">{user.roles.map((role) => role.name).join(", ")}</p>
        </div>
      </section>

      <PasswordSection />

      <button
        type="button"
        onClick={logout}
        className="w-full px-4 py-3 rounded-xl border border-red-400/40 text-red-300 hover:bg-red-500/10 transition-colors"
      >
        Log out
      </button>
    </div>
  );
}

/** Change password, or set a first one for accounts created with Google. */
function PasswordSection() {
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
