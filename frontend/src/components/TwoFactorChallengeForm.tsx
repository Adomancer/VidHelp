"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api";
import { homePathFor, saveSession } from "@/lib/auth";
import { formValue, useApiForm } from "@/lib/useApiForm";
import FormAlert from "./FormAlert";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

/**
 * Second sign-in step for admins with 2FA (after password or Google).
 * `onRestart` goes back to the first step when the challenge has expired.
 */
export default function TwoFactorChallengeForm({ challengeToken, onRestart }: { challengeToken: string; onRestart: () => void }) {
  const router = useRouter();
  const [useRecovery, setUseRecovery] = useState(false);

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      authApi.twoFactorChallenge(
        challengeToken,
        useRecovery ? { recovery_code: formValue(data, "recovery_code") } : { code: formValue(data, "code") }
      ),
    ({ token, user }) => {
      saveSession(token, user);
      router.replace(homePathFor(user));
    }
  );

  // Expired or too many wrong codes: the password/Google step has to be done again
  const expired = errors.challenge_token;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="text-center space-y-1">
        <p className="text-white font-medium">Verifikasi dua langkah</p>
        <p className="text-sm text-gray-300">
          {useRecovery
            ? "Masukkan salah satu kode pemulihan yang kamu simpan saat mengatur 2FA. Setiap kode hanya bisa dipakai sekali."
            : "Buka aplikasi authenticator kamu dan masukkan kode 6 digit untuk VidHelp."}
        </p>
      </div>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {expired && (
        <FormAlert tone="error">
          {expired}{" "}
          <button type="button" onClick={onRestart} className="underline hover:text-white">
            Masuk lagi
          </button>
        </FormAlert>
      )}

      {useRecovery ? (
        <TextField
          key="recovery"
          label="Kode pemulihan"
          name="recovery_code"
          placeholder="XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          required
          error={errors.recovery_code}
        />
      ) : (
        <TextField
          key="code"
          label="Kode"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="123456"
          className="text-center tracking-[0.5em] text-lg"
          autoFocus
          required
          error={errors.code}
        />
      )}

      <SubmitButton loading={loading}>Verifikasi</SubmitButton>

      <div className="flex justify-between text-sm">
        <button type="button" onClick={() => setUseRecovery(!useRecovery)} className="text-purple-300 hover:text-white">
          {useRecovery ? "Pakai kode dari aplikasi" : "HP hilang? Pakai kode pemulihan"}
        </button>
        <button type="button" onClick={onRestart} className="text-gray-400 hover:text-white">
          Batal
        </button>
      </div>
    </form>
  );
}
