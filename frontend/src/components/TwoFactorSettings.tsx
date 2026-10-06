"use client";

import { useState, type FormEvent } from "react";
import { errorMessage, fieldErrors, twoFactorApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
import RecoveryCodes from "./RecoveryCodes";
import TextField from "./TextField";
import TwoFactorSetup from "./TwoFactorSetup";

/** My own 2FA (admins and finance): status, new recovery codes, and turning it off when it isn't required. */
export default function TwoFactorSettings() {
  const { token, user, setUser } = useAuth();
  const status = useApiData("two-factor-status", () => twoFactorApi.status(token));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [codeError, setCodeError] = useState<string | undefined>();
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const code = String(new FormData(form).get("code") ?? "");

    setBusy(true);
    setNotice(null);
    setCodeError(undefined);
    try {
      if (submitter?.value === "disable") {
        setNotice({ tone: "success", text: (await twoFactorApi.disable(token, code)).message });
        setUser({ ...user, two_factor_enabled: false });
      } else {
        const result = await twoFactorApi.regenerateRecoveryCodes(token, code);
        setNewCodes(result.recovery_codes);
        setNotice({ tone: "success", text: result.message });
      }
      form.reset();
      status.reload();
    } catch (caught) {
      const fields = fieldErrors(caught);
      if (fields.code) setCodeError(fields.code);
      else setNotice({ tone: "error", text: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  const data = status.data;

  return (
    <Card
      title="Verifikasi dua langkah (2FA)"
      description="Setelah kata sandi atau Google, kamu juga memasukkan kode 6 digit dari aplikasi authenticator di HP."
    >
      {status.error && <FormAlert tone="error">{status.error}</FormAlert>}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}

      {data && !data.enabled && (
        <>
          {data.required && <FormAlert tone="warning">Wajib untuk akun kamu.</FormAlert>}
          <TwoFactorSetup
            onDone={(updated) => {
              setUser(updated);
              status.reload();
            }}
          />
        </>
      )}

      {data?.enabled && (
        <div className="space-y-4">
          <p className="text-sm text-body">
            <span className="text-success">Aktif ✓</span>
            {data.enabled_at && <span className="text-muted"> sejak {formatDate(data.enabled_at)}</span>}
            <span className={data.recovery_codes_left <= 2 ? "text-warning" : "text-muted"}>
              {" "}
              · sisa {data.recovery_codes_left} kode pemulihan
            </span>
          </p>

          {newCodes && <RecoveryCodes codes={newCodes} />}

          <form onSubmit={run} className="space-y-3" noValidate>
            <TextField
              label="Kode saat ini dari aplikasi"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="123456"
              required
              error={codeError}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                value="regenerate"
                disabled={busy}
                className="px-3 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary-hover disabled:opacity-50"
              >
                Buat kode pemulihan baru
              </button>
              {!data.required && (
                <button
                  type="submit"
                  value="disable"
                  disabled={busy}
                  className="px-3 py-2 rounded-lg border border-red-400/40 text-danger text-sm hover:bg-red-500/10 disabled:opacity-50"
                >
                  Matikan 2FA
                </button>
              )}
            </div>
            <p className="text-xs text-muted">
              {data.required
                ? "2FA wajib untuk akun kamu, jadi tidak bisa dimatikan. HP hilang? Masuk dengan kode pemulihan, atau minta admin lain mereset 2FA kamu."
                : "HP hilang? Masuk dengan kode pemulihan, atau minta admin lain mereset 2FA kamu."}
            </p>
          </form>
        </div>
      )}
    </Card>
  );
}
