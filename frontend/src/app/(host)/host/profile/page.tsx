"use client";

import { useState } from "react";
import { errorMessage, hostApi, type MyProfile } from "@/lib/api";
import { formatDate, formatTenure } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import UserAvatar from "@/components/UserAvatar";
import DiscordConnect from "@/components/DiscordConnect";
import PasswordForm from "@/components/PasswordForm";

type HostProfileData = NonNullable<MyProfile["host_profile"]>;

export default function HostProfilePage() {
  const { token, logout, setUser } = useAuth();
  const profile = useApiData("profile", () => hostApi.profile(token));

  /** Every profile endpoint returns the full profile; keep page + header in sync. */
  function applyUpdate(updated: MyProfile) {
    profile.setData(updated);
    setUser(updated.user);
  }

  const host = profile.data?.host_profile ?? null;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-bold text-white">My Profile</h1>

      {profile.error && <FormAlert tone="error">{profile.error}</FormAlert>}

      <HeaderCard host={host} onUpdated={applyUpdate} />
      {profile.data && <PersonalForm data={profile.data} onUpdated={applyUpdate} />}
      {host && <BrandsCard host={host} />}
      {host && <IdentityForm host={host} onUpdated={applyUpdate} />}
      <DiscordConnect />
      <PasswordForm />

      <button
        type="button"
        onClick={logout}
        className="w-full px-4 py-3 rounded-xl border border-red-400/40 text-red-300 hover:bg-red-500/10 transition-colors"
      >
        Log out
      </button>
    </div>
  );
}

/** Photo, name, role and (for hosts) rate level + tenure. */
function HeaderCard({ host, onUpdated }: { host: HostProfileData | null; onUpdated: (profile: MyProfile) => void }) {
  const { user, token } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      onUpdated(await hostApi.uploadPhoto(token, file));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-2">
          <UserAvatar size="w-16 h-16" />
          <label className="text-xs text-purple-300 hover:text-white cursor-pointer">
            {uploading ? "Uploading…" : "Change photo"}
            <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(event) => upload(event.target.files?.[0])} />
          </label>
        </div>
        <div className="min-w-0">
          <p className="text-white font-medium truncate">{user.name}</p>
          <p className="text-sm text-gray-400 truncate">{user.email}</p>
          <p className="text-xs text-purple-300 mt-1 capitalize">{user.roles.map((role) => role.name).join(", ")}</p>
          {host && (
            <p className="text-xs text-gray-400 mt-1">
              {host.rate_category?.name ?? "No rate level"} · joined {formatDate(host.join_date)} ({formatTenure(host.join_date)})
            </p>
          )}
        </div>
      </div>
      {error && <FormAlert tone="error">{error}</FormAlert>}
    </Card>
  );
}

function PersonalForm({ data, onUpdated }: { data: MyProfile; onUpdated: (profile: MyProfile) => void }) {
  const { token } = useAuth();
  const [saved, setSaved] = useState<string | null>(null);
  const host = data.host_profile;

  const { loading, errors, error, handleSubmit } = useApiForm(
    (form) =>
      hostApi.updateProfile(token, {
        name: formValue(form, "name"),
        ...(host && {
          phone: formValue(form, "phone") || null,
          guardian_phone: formValue(form, "guardian_phone") || null,
        }),
      }),
    (updated) => {
      setSaved(updated.message);
      onUpdated(updated);
    }
  );

  return (
    <Card title="Personal info">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {saved && <FormAlert tone="success">{saved}</FormAlert>}

        <TextField label="Full name" name="name" defaultValue={data.user.name} autoComplete="name" required error={errors.name} />
        {host && (
          <>
            <TextField label="Phone (WhatsApp)" name="phone" type="tel" defaultValue={host.phone ?? ""} placeholder="08…" autoComplete="tel" error={errors.phone} />
            <TextField label="Guardian / family phone" name="guardian_phone" type="tel" defaultValue={host.guardian_phone ?? ""} placeholder="08…" error={errors.guardian_phone} />
          </>
        )}

        <SubmitButton loading={loading}>Save</SubmitButton>
      </form>
    </Card>
  );
}

function BrandsCard({ host }: { host: HostProfileData }) {
  return (
    <Card title="My brands">
      {host.assignments.length === 0 ? (
        <p className="text-sm text-gray-400">You haven&apos;t been assigned to a brand yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {host.assignments.map((assignment) => (
            <li key={assignment.id} className="px-3 py-1.5 rounded-lg bg-slate-800 text-sm text-white">
              {assignment.brand.name}
              {assignment.is_leader && <span className="text-yellow-300"> ★ Leader</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * KTP + bank. Saved values come back masked, so fields start empty and only
 * the ones the host types in are sent.
 */
function IdentityForm({ host, onUpdated }: { host: HostProfileData; onUpdated: (profile: MyProfile) => void }) {
  const { token } = useAuth();
  const [saved, setSaved] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const current = host.sensitive_data;

  const { loading, errors, error, handleSubmit } = useApiForm(
    (form) => {
      const fields = ["ktp_number", "bank_name", "bank_account", "account_holder_name"] as const;
      const changed = Object.fromEntries(fields.map((field) => [field, formValue(form, field).trim()]).filter(([, value]) => value));
      return hostApi.updateSensitive(token, changed);
    },
    (updated, form) => {
      form.reset();
      setSaved(updated.message);
      onUpdated(updated);
    }
  );

  async function uploadKtp(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      onUpdated(await hostApi.uploadKtpImage(token, file));
    } catch (caught) {
      setUploadError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card title="KTP & bank account" description="Needed for payroll. Stored encrypted; only the admin can see the full numbers.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}
        {saved && <FormAlert tone="success">{saved}</FormAlert>}

        <TextField
          label="KTP number (NIK)"
          name="ktp_number"
          inputMode="numeric"
          maxLength={16}
          placeholder={current?.ktp_number_masked ?? "16 digits"}
          error={errors.ktp_number}
        />
        <TextField label="Bank" name="bank_name" placeholder={current?.bank_name ?? "e.g. BCA"} error={errors.bank_name} />
        <TextField
          label="Account number"
          name="bank_account"
          inputMode="numeric"
          placeholder={current?.bank_account_masked ?? "Digits only"}
          error={errors.bank_account}
        />
        <TextField
          label="Account holder name"
          name="account_holder_name"
          placeholder={current?.account_holder_name ?? "As printed on the account"}
          error={errors.account_holder_name}
        />
        <p className="text-xs text-gray-400">Leave a field empty to keep what&apos;s saved.</p>

        <SubmitButton loading={loading}>Save</SubmitButton>
      </form>

      <div className="border-t border-slate-800 pt-4 space-y-2">
        <p className="text-sm text-gray-200">
          KTP photo:{" "}
          {current?.has_ktp_image ? <span className="text-green-300">uploaded ✓</span> : <span className="text-gray-400">not uploaded</span>}
        </p>
        <label className="inline-block px-4 py-2 rounded-lg border border-slate-700 text-sm text-gray-300 hover:bg-slate-800 cursor-pointer">
          {uploading ? "Uploading…" : current?.has_ktp_image ? "Replace KTP photo" : "Upload KTP photo"}
          <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(event) => uploadKtp(event.target.files?.[0])} />
        </label>
        {uploadError && <FormAlert tone="error">{uploadError}</FormAlert>}
      </div>
    </Card>
  );
}
