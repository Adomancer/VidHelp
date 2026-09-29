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

/** An admin's own 2FA: status, new recovery codes, and turning it off when it isn't required. */
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
      title="Two-factor authentication"
      description="After your password or Google, you also enter a 6-digit code from an authenticator app on your phone."
    >
      {status.error && <FormAlert tone="error">{status.error}</FormAlert>}
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}

      {data && !data.enabled && (
        <>
          {data.required && <FormAlert tone="warning">Required for admin accounts.</FormAlert>}
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
          <p className="text-sm text-gray-200">
            <span className="text-green-300">On ✓</span>
            {data.enabled_at && <span className="text-gray-400"> since {formatDate(data.enabled_at)}</span>}
            <span className={data.recovery_codes_left <= 2 ? "text-yellow-200" : "text-gray-400"}>
              {" "}
              · {data.recovery_codes_left} recovery code{data.recovery_codes_left === 1 ? "" : "s"} left
            </span>
          </p>

          {newCodes && <RecoveryCodes codes={newCodes} />}

          <form onSubmit={run} className="space-y-3" noValidate>
            <TextField
              label="Current code from the app"
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
                className="px-3 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-50"
              >
                Make new recovery codes
              </button>
              {!data.required && (
                <button
                  type="submit"
                  value="disable"
                  disabled={busy}
                  className="px-3 py-2 rounded-lg border border-red-400/40 text-red-300 text-sm hover:bg-red-500/10 disabled:opacity-50"
                >
                  Turn off 2FA
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400">
              {data.required
                ? "2FA is required for admins, so it can't be turned off. Lost your phone? Sign in with a recovery code, or ask another admin to reset your 2FA."
                : "Lost your phone? Sign in with a recovery code, or ask another admin to reset your 2FA."}
            </p>
          </form>
        </div>
      )}
    </Card>
  );
}
