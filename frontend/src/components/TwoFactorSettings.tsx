"use client";

import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { shownKeys, splitApiError, twoFactorApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
import { ListSkeleton } from "./Loading";
import OtpField from "./OtpField";
import RecoveryCodes from "./RecoveryCodes";
import StatusBadge from "./StatusBadge";
import { notify } from "./Toast";
import TwoFactorSetup from "./TwoFactorSetup";

/** My own 2FA (admins and finance): status, new recovery codes, and turning it off when it isn't required. */
export default function TwoFactorSettings() {
  const { token, user, setUser } = useAuth();
  const status = useApiData("two-factor-status", () => twoFactorApi.status(token));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | undefined>();
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const code = String(new FormData(form).get("code") ?? "");

    setBusy(true);
    setError(null);
    setCodeError(undefined);
    try {
      if (submitter?.value === "disable") {
        notify({ text: (await twoFactorApi.disable(token, code)).message });
        setUser({ ...user, two_factor_enabled: false });
      } else {
        const result = await twoFactorApi.regenerateRecoveryCodes(token, code);
        setNewCodes(result.recovery_codes);
        notify({ text: result.message });
      }
      setFormKey((current) => current + 1);
      status.reload();
    } catch (caught) {
      const { fields, message } = splitApiError(caught, shownKeys("code"));
      if (fields.code) setCodeError(fields.code);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const data = status.data;

  return (
    <Card
      title="Verifikasi dua langkah (2FA)"
      description="Setelah kata sandi atau Google, kamu juga memasukkan kode 6 digit dari aplikasi authenticator di HP."
      action={data?.enabled ? <StatusBadge tone="success" dot>Aktif</StatusBadge> : data ? <StatusBadge tone="neutral">Belum aktif</StatusBadge> : undefined}
    >
      {status.error && <FormAlert tone="error">{status.error}</FormAlert>}
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {!data && !status.error && <ListSkeleton rows={2} />}

      {data && !data.enabled && (
        <>
          {data.required && <FormAlert tone="warning">2FA wajib untuk akun kamu.</FormAlert>}
          <TwoFactorSetup
            onDone={(updated) => {
              setUser(updated);
              status.reload();
            }}
          />
        </>
      )}

      {data?.enabled && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
            <span className="flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
              Terlindungi{data.enabled_at && <span className="font-normal text-muted-foreground">sejak {formatDate(data.enabled_at)}</span>}
            </span>
            <span className={cn("text-sm", data.recovery_codes_left <= 2 ? "font-medium text-warning" : "text-muted-foreground")}>
              Sisa {data.recovery_codes_left} kode pemulihan
            </span>
          </div>

          {newCodes && <RecoveryCodes codes={newCodes} />}

          <form key={formKey} onSubmit={run} className="space-y-4" noValidate>
            <OtpField label="Kode saat ini dari aplikasi" name="code" error={codeError} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" value="regenerate" disabled={busy}>
                Buat kode pemulihan baru
              </Button>
              {!data.required && (
                <Button type="submit" value="disable" variant="outline" disabled={busy} className="text-destructive hover:text-destructive">
                  Matikan 2FA
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
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
