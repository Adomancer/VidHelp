"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage, fieldErrors, settingsApi, type Setting, type SettingGroup, type SettingValue } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { TWO_FACTOR_SETUP_PATH } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";

const TWO_FACTOR_KEY = "two_factor.required_for_admins";

/** Inputs keep text while typing; numbers are parsed on save. */
type Draft = Record<string, string | boolean>;

function toDraft(value: SettingValue): string | boolean {
  return typeof value === "boolean" ? value : String(value);
}

function fromDraft(value: string | boolean): SettingValue | string {
  if (typeof value === "boolean") return value;
  return value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
}

function showValue(setting: Setting, value: SettingValue): string {
  if (typeof value === "boolean") return value ? "Aktif" : "Nonaktif";
  return setting.unit ? `${value} ${setting.unit}` : String(value);
}

export default function AdminSettingsPage() {
  const { token } = useAuth();
  const settings = useApiData("admin-settings", () => settingsApi.all(token));
  const [saved, setSaved] = useState<{ version: number; message: string } | null>(null);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-heading">Pengaturan</h1>
        <p className="text-sm text-muted mt-1">
          Aturan bisnis yang diikuti seluruh aplikasi. Perubahan langsung berlaku dan tercatat di Log Audit.
        </p>
      </div>

      {settings.error && <FormAlert tone="error">{settings.error}</FormAlert>}
      {saved && <FormAlert tone="success">{saved.message}</FormAlert>}

      {settings.data && (
        <SettingsForm
          // A fresh form after each save, filled from what the server stored
          key={saved?.version ?? 0}
          groups={settings.data.groups}
          onSaved={(groups, message) => {
            settings.setData({ groups });
            setSaved((current) => ({ version: (current?.version ?? 0) + 1, message }));
          }}
        />
      )}
    </div>
  );
}

function SettingsForm({ groups, onSaved }: { groups: SettingGroup[]; onSaved: (groups: SettingGroup[], message: string) => void }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const all = groups.flatMap((group) => group.settings);
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(all.map((setting) => [setting.key, toDraft(setting.value)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changed = all.filter((setting) => fromDraft(draft[setting.key]) !== setting.value);
  const turningOn2fa = draft[TWO_FACTOR_KEY] === true && all.find((setting) => setting.key === TWO_FACTOR_KEY)?.value === false;

  async function save() {
    setSaving(true);
    setErrors({});
    setError(null);
    try {
      const values = Object.fromEntries(changed.map((setting) => [setting.key, fromDraft(draft[setting.key])])) as Record<string, SettingValue>;
      const result = await settingsApi.save(token, values);
      if (turningOn2fa && !user.two_factor_enabled) {
        router.replace(TWO_FACTOR_SETUP_PATH); // this admin is now required to set it up
        return;
      }
      onSaved(result.groups, result.message);
    } catch (caught) {
      const fields = fieldErrors(caught);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 pb-4">
      {groups.map((group) => (
        <Card key={group.key} title={group.label}>
          <div className="divide-y divide-stroke -my-2">
            {group.settings.map((setting) => (
              <SettingRow
                key={setting.key}
                setting={setting}
                value={draft[setting.key]}
                error={errors[setting.key]}
                onChange={(value) => setDraft({ ...draft, [setting.key]: value })}
              />
            ))}
          </div>
        </Card>
      ))}

      {changed.length > 0 && (
        <div className="sticky bottom-4 z-10 rounded-xl border border-primary/40 bg-surface backdrop-blur p-4 space-y-3 shadow-2xl">
          {error && <FormAlert tone="error">{error}</FormAlert>}
          {turningOn2fa && (
            <FormAlert tone="warning">
              Admin dan finance yang belum memakai verifikasi dua langkah{user.two_factor_enabled ? "" : ", termasuk kamu,"} harus mengaturnya dulu sebelum bisa
              melakukan hal lain.
            </FormAlert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-body">
              {changed.length} perubahan belum disimpan
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setDraft(Object.fromEntries(all.map((setting) => [setting.key, toDraft(setting.value)])));
                  setErrors({});
                  setError(null);
                }}
                className="px-4 py-2 rounded-lg border border-stroke-strong text-sm text-body hover:bg-surface-2 disabled:opacity-50"
              >
                Buang
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={save}
                className="px-4 py-2 rounded-lg bg-primary text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {saving ? "Menyimpan…" : "Simpan perubahan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingRow({
  setting,
  value,
  error,
  onChange,
}: {
  setting: Setting;
  value: string | boolean;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const isDefault = fromDraft(value) === setting.default;
  const inputClass = `rounded-lg bg-canvas border px-3 py-2 text-sm text-heading outline-none focus:ring-2 focus:ring-primary ${
    error ? "border-red-400" : "border-stroke-strong"
  }`;

  return (
    <div className="py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:max-w-md">
        <label htmlFor={setting.key} className="block text-sm font-medium text-heading">
          {setting.label}
        </label>
        <p className="text-xs text-muted mt-1">{setting.help}</p>
        <p className="text-xs mt-1">
          {setting.changed_at ? (
            <span className="text-accent">
              Diubah{setting.changed_by && <> oleh {setting.changed_by}</>} pada {formatDate(setting.changed_at)} · bawaan{" "}
              {showValue(setting, setting.default)}
            </span>
          ) : (
            <span className="text-faint">Nilai bawaan</span>
          )}
        </p>
        {error && <p className="text-sm text-danger mt-1">{error}</p>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {setting.type === "bool" ? (
          <button
            id={setting.key}
            type="button"
            role="switch"
            aria-checked={value === true}
            onClick={() => onChange(value !== true)}
            className={`relative w-11 h-6 rounded-full transition-colors ${value === true ? "bg-primary" : "bg-surface-3"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${value === true ? "translate-x-5" : ""}`} />
          </button>
        ) : setting.options ? (
          <select id={setting.key} value={String(value)} onChange={(event) => onChange(event.target.value)} className={inputClass}>
            {setting.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={setting.key}
            type="number"
            inputMode="numeric"
            min={setting.min}
            max={setting.max}
            value={String(value)}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            className={`w-24 text-right ${inputClass}`}
          />
        )}
        {setting.unit && setting.type !== "bool" && <span className="text-sm text-muted w-16">{setting.unit}</span>}
        <button
          type="button"
          onClick={() => onChange(toDraft(setting.default))}
          disabled={isDefault}
          className="text-xs text-accent hover:text-heading disabled:invisible"
        >
          Pakai bawaan
        </button>
      </div>
    </div>
  );
}
