"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api";
import { homePathFor, saveSession } from "@/lib/auth";
import { formValue, useApiForm } from "@/lib/useApiForm";
import FormAlert from "./FormAlert";
import GoogleButton from "./GoogleButton";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";
import TwoFactorChallengeForm from "./TwoFactorChallengeForm";

export default function LoginForm() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<string | null>(null);
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => authApi.login(formValue(data, "email"), formValue(data, "password")),
    (result) => {
      if ("two_factor" in result) {
        setChallenge(result.challenge_token); // admin with 2FA: ask for the code next
        return;
      }
      saveSession(result.token, result.user);
      router.replace(homePathFor(result.user));
    }
  );

  if (challenge) {
    return <TwoFactorChallengeForm challengeToken={challenge} onRestart={() => setChallenge(null)} />;
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <TextField label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
        <TextField label="Kata sandi" name="password" type="password" autoComplete="current-password" required error={errors.password} />

        <div className="text-right">
          <Link href="/forgot-password" className="text-sm text-purple-300 hover:text-white">
            Lupa kata sandi?
          </Link>
        </div>

        <SubmitButton loading={loading}>Masuk</SubmitButton>
      </form>

      <Divider />
      <GoogleButton />
    </div>
  );
}

export function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-gray-400">
      <span className="h-px flex-1 bg-white/15" />
      atau
      <span className="h-px flex-1 bg-white/15" />
    </div>
  );
}
