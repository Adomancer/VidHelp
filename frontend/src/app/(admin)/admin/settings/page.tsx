"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { errorMessage, fieldErrors, settingsApi, type Setting, type SettingGroup, type SettingValue } from "@/lib/api";
import { TWO_FACTOR_SETUP_PATH } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { inputSmClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import ErrorState from "@/components/ErrorState";
import { FieldError } from "@/components/FieldMessage";
import FormAlert from "@/components/FormAlert";
import { CardsSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import { NativeSelect } from "@/components/SelectField";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

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

const sectionId = (group: SettingGroup) => `pengaturan-${group.key}`;

export default function AdminSettingsPage() {
  const { token } = useAuth();
  const settings = useApiData("admin-settings", () => settingsApi.all(token));
  const [version, setVersion] = useState(0);
  const groups = settings.data?.groups;

  return (
    <div className="space-y-6">
      <PageHeader title="Pengaturan" description="Aturan bisnis yang diikuti seluruh aplikasi. Perubahan langsung berlaku dan tercatat di Log Audit." />

      {settings.error && <ErrorState message={settings.error} onRetry={settings.reload} />}

      <div className="grid items-start gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,52rem)]">
        <nav aria-label="Bagian pengaturan" className="hidden lg:sticky lg:top-20 lg:block">
          <ul className="space-y-0.5 text-sm">
            {groups?.map((group) => (
              <li key={group.key}>
                <a
                  href={`#${sectionId(group)}`}
                  className="block rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {group.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          {!groups && !settings.error && <CardsSkeleton count={3} />}
          {groups && (
            <SettingsForm
              // A fresh form after each save, filled from what the server stored
              key={version}
              groups={groups}
              onSaved={(next, message) => {
                settings.setData({ groups: next });
                setVersion((current) => current + 1);
                notify({ text: message });
              }}
            />
          )}
        </div>
      </div>
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
        <Card key={group.key} id={sectionId(group)} title={group.label} className="scroll-mt-20">
          <div className="-my-2 divide-y divide-border">
            {group.settings.map((setting) => (
              <SettingRow
                key={setting.key}
                setting={setting}
                value={draft[setting.key]}
                changed={fromDraft(draft[setting.key]) !== setting.value}
                error={errors[setting.key]}
                onChange={(value) => setDraft({ ...draft, [setting.key]: value })}
              />
            ))}
          </div>
        </Card>
      ))}

      {changed.length > 0 && (
        <div className="sticky bottom-4 z-10 space-y-3 rounded-xl border border-primary/30 bg-popover/95 p-4 shadow-lg ring-1 ring-foreground/5 backdrop-blur-md animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
          {error && <FormAlert tone="error">{error}</FormAlert>}
          {turningOn2fa && (
            <FormAlert tone="warning">
              Admin dan finance yang belum memakai verifikasi dua langkah{user.two_factor_enabled ? "" : ", termasuk kamu,"} harus mengaturnya dulu sebelum
              bisa melakukan hal lain.
            </FormAlert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-body">
              <span className="font-semibold text-foreground tabular-nums">{changed.length}</span> perubahan belum disimpan
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setDraft(Object.fromEntries(all.map((setting) => [setting.key, toDraft(setting.value)])));
                  setErrors({});
                  setError(null);
                }}
              >
                Buang
              </Button>
              <Button type="button" disabled={saving} onClick={save}>
                {saving ? "Menyimpan…" : "Simpan perubahan"}
              </Button>
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
  changed,
  error,
  onChange,
}: {
  setting: Setting;
  value: string | boolean;
  changed: boolean;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const isDefault = fromDraft(value) === setting.default;

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:max-w-md">
        <label htmlFor={setting.key} className="flex items-center gap-2 text-sm font-medium text-foreground">
          {setting.label}
          {changed && <span className="size-1.5 rounded-full bg-primary" aria-label="Diubah, belum disimpan" />}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">{setting.help}</p>
        <p className="mt-1 text-xs">
          {setting.changed_at ? (
            <span className="text-brand">
              Diubah{setting.changed_by && <> oleh {setting.changed_by}</>} pada {formatDate(setting.changed_at)} · bawaan {showValue(setting, setting.default)}
            </span>
          ) : (
            <span className="text-faint">Nilai bawaan</span>
          )}
        </p>
        <div className="mt-1">
          <FieldError>{error}</FieldError>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {setting.type === "bool" ? (
          <Switch id={setting.key} checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
        ) : setting.options ? (
          <NativeSelect small id={setting.key} value={String(value)} onChange={(event) => onChange(event.target.value)} wrapperClassName="w-40">
            {setting.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
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
            className={cn(inputSmClass, "w-24 text-right tabular-nums")}
          />
        )}
        {setting.unit && setting.type !== "bool" && <span className="w-16 text-sm text-muted-foreground">{setting.unit}</span>}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange(toDraft(setting.default))}
          disabled={isDefault}
          title="Pakai nilai bawaan"
          aria-label={`Pakai nilai bawaan untuk ${setting.label}`}
          className={cn("max-md:size-10", "text-muted-foreground", isDefault && "invisible")}
        >
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}
