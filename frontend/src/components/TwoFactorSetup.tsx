"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { errorMessage, twoFactorApi, type AuthUser } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "./AuthProvider";
import FormAlert from "./FormAlert";
import RecoveryCodes from "./RecoveryCodes";
import SubmitButton from "./SubmitButton";
import TextField from "./TextField";

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
        <button
          type="button"
          onClick={() => onDone(done.user)}
          className="w-full px-4 py-3 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-500"
        >
          Kode pemulihan sudah saya simpan
        </button>
      </div>
    );
  }

  if (!secret) {
    return (
      <div className="space-y-4">
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-300">
          <li>Pasang aplikasi authenticator di HP kamu: Google Authenticator, Microsoft Authenticator atau Authy.</li>
          <li>Scan kode QR yang muncul di langkah berikutnya.</li>
          <li>Ketik kode 6 digit dari aplikasi untuk menyelesaikan.</li>
        </ol>
        {startError && <FormAlert tone="error">{startError}</FormAlert>}
        <button
          type="button"
          onClick={start}
          disabled={starting}
          className="w-full px-4 py-3 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-500 disabled:opacity-60"
        >
          {starting ? "Tunggu sebentar…" : "Mulai pengaturan"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <p className="text-sm text-gray-300">Scan kode ini dengan aplikasi authenticator kamu:</p>
      <div className="flex justify-center">
        <div className="p-3 rounded-xl bg-white">
          <QRCodeSVG value={secret.otpauth_url} size={184} marginSize={0} />
        </div>
      </div>
      <details className="text-sm text-gray-400">
        <summary className="cursor-pointer hover:text-white">Tidak bisa scan? Masukkan kuncinya manual</summary>
        <p className="mt-2 font-mono text-white break-all select-all bg-slate-950 border border-slate-700 rounded-lg px-3 py-2">
          {secret.secret.match(/.{1,4}/g)?.join(" ")}
        </p>
        <p className="mt-1 text-xs">Pilih &quot;time based&quot; (berbasis waktu) kalau aplikasi bertanya.</p>
      </details>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      <TextField
        label="Kode 6 digit dari aplikasi"
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
      <SubmitButton loading={loading}>Aktifkan 2FA</SubmitButton>
    </form>
  );
}
