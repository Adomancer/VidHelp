"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { authApi } from "@/lib/api";
import { homePathFor, saveSession } from "@/lib/auth";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { Button } from "@/components/ui/button";
import FormAlert from "./FormAlert";
import OtpField from "./OtpField";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

/**
 * Second sign-in step for admins with 2FA (after password or Google).
 * `onRestart` goes back to the first step when the challenge has expired.
 */
export default function TwoFactorChallengeForm({ challengeToken, onRestart }: { challengeToken: string; onRestart: () => void }) {
  const router = useRouter();
  const [useRecovery, setUseRecovery] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

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
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-brand">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-foreground">Verifikasi dua langkah</p>
          <p className="text-sm text-muted-foreground">
            {useRecovery
              ? "Masukkan salah satu kode pemulihan yang kamu simpan saat mengatur 2FA. Setiap kode hanya bisa dipakai sekali."
              : "Buka aplikasi authenticator kamu dan masukkan kode 6 digit untuk VidHelp."}
          </p>
        </div>
      </div>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {expired && (
        <FormAlert tone="error">
          {expired}{" "}
          <button type="button" onClick={onRestart} className="font-medium underline underline-offset-2">
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
          className="font-mono tracking-wider"
          error={errors.recovery_code}
        />
      ) : (
        <OtpField key="code" label="Kode dari aplikasi" name="code" autoFocus error={errors.code} onComplete={() => formRef.current?.requestSubmit()} />
      )}

      <SubmitButton loading={loading}>Verifikasi</SubmitButton>

      <div className="flex items-center justify-between gap-3 text-sm">
        <Button type="button" variant="link" onClick={() => setUseRecovery(!useRecovery)} className="h-auto px-0">
          {useRecovery ? "Pakai kode dari aplikasi" : "HP hilang? Pakai kode pemulihan"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRestart} className="text-muted-foreground">
          Batal
        </Button>
      </div>
    </form>
  );
}
