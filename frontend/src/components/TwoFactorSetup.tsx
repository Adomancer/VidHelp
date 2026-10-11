"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { errorMessage, twoFactorApi, type AuthUser } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import FormAlert from "./FormAlert";
import OtpField from "./OtpField";
import RecoveryCodes from "./RecoveryCodes";
import SubmitButton from "./SubmitButton";

const steps = [
  "Pasang aplikasi authenticator di HP kamu: Google Authenticator, Microsoft Authenticator atau Authy.",
  "Scan kode QR yang muncul di langkah berikutnya.",
  "Ketik kode 6 digit dari aplikasi untuk menyelesaikan.",
];

/**
 * Turn on 2FA: scan the QR code, confirm with the first code, save the recovery codes.
 * `onDone` runs when the admin has seen the recovery codes and continues.
 */
export default function TwoFactorSetup({ onDone }: { onDone: (user: AuthUser) => void }) {
  const { token, setUser } = useAuth();
  const [secret, setSecret] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [done, setDone] = useState<{ codes: string[]; user: AuthUser } | null>(null);

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      setSecret(await twoFactorApi.setup(token));
    } catch (caught) {
      setStartError(errorMessage(caught));
    } finally {
      setStarting(false);
    }
  }

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => twoFactorApi.confirm(token, formValue(data, "code")),
    ({ recovery_codes, user }) => {
      setUser(user);
      setDone({ codes: recovery_codes, user });
    }
  );

  if (done) {
    return (
      <div className="space-y-4">
        <FormAlert tone="success">Verifikasi dua langkah sudah aktif.</FormAlert>
        <RecoveryCodes codes={done.codes} />
        <Button type="button" size="lg" onClick={() => onDone(done.user)} className="w-full">
          Kode pemulihan sudah saya simpan
        </Button>
      </div>
    );
  }

  if (!secret) {
    return (
      <div className="space-y-5">
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm text-body">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-brand">{index + 1}</span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        {startError && <FormAlert tone="error">{startError}</FormAlert>}
        <Button type="button" size="lg" onClick={start} disabled={starting} className="w-full">
          {starting ? "Tunggu sebentar…" : "Mulai pengaturan"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <p className="text-sm text-body">Scan kode ini dengan aplikasi authenticator kamu:</p>
      <div className="flex justify-center">
        <div className="rounded-xl border border-border bg-white p-4 shadow-xs">
          <QRCodeSVG value={secret.otpauth_url} size={184} marginSize={0} />
        </div>
      </div>
      <details className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium hover:text-foreground">Tidak bisa scan? Masukkan kuncinya manual</summary>
        <p className="mt-2 rounded-md border border-input bg-muted/50 px-3 py-2 font-mono break-all text-foreground select-all">
          {secret.secret.match(/.{1,4}/g)?.join(" ")}
        </p>
        <p className="mt-1.5 text-xs">Pilih &quot;time based&quot; (berbasis waktu) kalau aplikasi bertanya.</p>
      </details>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      <OtpField label="Kode 6 digit dari aplikasi" name="code" autoFocus error={errors.code} />
      <SubmitButton loading={loading}>Aktifkan 2FA</SubmitButton>
    </form>
  );
}
