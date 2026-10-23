"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api";
import { homePathFor } from "@/lib/auth";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useSignIn } from "./AuthProvider";
import FormAlert from "./FormAlert";
import GoogleButton from "./GoogleButton";
import PasswordField from "./PasswordField";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";
import TwoFactorChallengeForm from "./TwoFactorChallengeForm";

export default function LoginForm() {
  const router = useRouter();
  const signIn = useSignIn();
  const [challenge, setChallenge] = useState<string | null>(null);
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => authApi.login(formValue(data, "email"), formValue(data, "password")),
    (result) => {
      if ("two_factor" in result) {
        setChallenge(result.challenge_token); // admin with 2FA: ask for the code next
        return;
      }
      signIn(result.token, result.user);
      router.replace(homePathFor(result.user));
    }
  );

  if (challenge) {
    return <TwoFactorChallengeForm challengeToken={challenge} onRestart={() => setChallenge(null)} />;
  }

  return (
    <div className="space-y-6">
      <GoogleButton />
      <Divider />

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <TextField label="Email" name="email" type="email" autoComplete="email" placeholder="nama@email.com" required error={errors.email} />
        <PasswordField
          label="Kata sandi"
          name="password"
          autoComplete="current-password"
          required
          error={errors.password}
          labelAside={
            <Link href="/forgot-password" className="text-sm font-medium text-brand hover:underline">
              Lupa kata sandi?
            </Link>
          }
        />

        <SubmitButton loading={loading}>Masuk</SubmitButton>
      </form>
    </div>
  );
}

export function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      atau dengan email
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
