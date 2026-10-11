"use client";

import { useState } from "react";
import { Camera, CircleCheck, Crown, LogOut, Upload } from "lucide-react";
import { errorMessage, hostApi, type MyProfile } from "@/lib/api";
import { formatDate, formatTenure } from "@/lib/format";
import { roleLabel } from "@/lib/labels";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import DigitsField from "@/components/DigitsField";
import DiscordConnect from "@/components/DiscordConnect";
import ErrorState from "@/components/ErrorState";
import FormAlert from "@/components/FormAlert";
import { CardsSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import PasswordForm from "@/components/PasswordForm";
import StatusBadge from "@/components/StatusBadge";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import { notify } from "@/components/Toast";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";

type HostProfileData = NonNullable<MyProfile["host_profile"]>;

const sections = [
  { id: "data-pribadi", label: "Data pribadi" },
  { id: "brand", label: "Brand", hostOnly: true },
  { id: "identitas", label: "KTP & bank", hostOnly: true },
  { id: "discord", label: "Discord" },
  { id: "keamanan", label: "Kata sandi" },
];

export default function HostProfilePage() {
  const { token, logout, setUser } = useAuth();
  const profile = useApiData("my-profile", () => hostApi.profile(token));

  /** Every profile endpoint returns the full profile; keep page + header in sync. */
  function applyUpdate(updated: MyProfile) {
    profile.setData(updated);
    setUser(updated.user);
  }

  const host = profile.data?.host_profile ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="Profil saya" description="Data diri, rekening untuk gaji, dan keamanan akun." />

      {profile.error && <ErrorState message={profile.error} onRetry={profile.reload} />}

      <div className="grid items-start gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,48rem)]">
        <nav aria-label="Bagian profil" className="hidden lg:sticky lg:top-20 lg:block">
          <ul className="space-y-0.5 text-sm">
            {sections
              .filter((section) => !section.hostOnly || host)
              .map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6 [&>section]:scroll-mt-20">
          <HeaderCard host={host} onUpdated={applyUpdate} />
          {!profile.data && !profile.error && <CardsSkeleton count={2} />}
          {profile.data && <PersonalForm data={profile.data} onUpdated={applyUpdate} />}
          {host && <BrandsCard host={host} />}
          {host && <IdentityForm host={host} onUpdated={applyUpdate} />}
          <DiscordConnect id="discord" />
          <PasswordForm id="keamanan" />

          <Card title="Keluar" description="Keluar dari VidHelp di perangkat ini.">
            <Button type="button" variant="outline" onClick={() => void logout()} className="w-full text-destructive hover:text-destructive sm:w-auto">
              <LogOut aria-hidden="true" />
              Keluar
            </Button>
          </Card>
        </div>
      </div>
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
      notify({ text: "Foto profil diperbarui" });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <label className="group relative shrink-0 cursor-pointer rounded-full focus-within:ring-3 focus-within:ring-ring/50" title="Ganti foto">
          <UserAvatar size="size-20 text-2xl" />
          <span
            className={cn(
              "absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-xs transition-transform group-hover:scale-105",
              uploading && "animate-pulse"
            )}
          >
            <Camera className="size-3.5" aria-hidden="true" />
          </span>
          <span className="sr-only">{uploading ? "Mengunggah foto…" : "Ganti foto profil"}</span>
          <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(event) => upload(event.target.files?.[0])} />
        </label>
        <div className="min-w-0 space-y-1.5">
          <div>
            <p className="truncate text-lg font-semibold text-foreground">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 sm:justify-start">
            {user.roles.map((role) => (
              <StatusBadge key={role.name} tone="brand">
                {roleLabel(role.name)}
              </StatusBadge>
            ))}
            {host && <StatusBadge tone="neutral">{host.rate_category?.name ?? "Belum ada level tarif"}</StatusBadge>}
          </div>
          {host && (
            <p className="text-xs text-muted-foreground">
              Bergabung {formatDate(host.join_date)} · {formatTenure(host.join_date)}
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
      notify({ text: updated.message });
      onUpdated(updated);
    }
  );

  return (
    <Card id="data-pribadi" title="Data pribadi">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <TextField label="Nama lengkap" name="name" defaultValue={data.user.name} autoComplete="name" required error={errors.name} />
        {host && (
          <div className="grid gap-4 sm:grid-cols-2">
            <DigitsField label="No. HP (WhatsApp)" name="phone" defaultValue={host.phone} maxLength={15} placeholder="08…" autoComplete="tel" error={errors.phone} />
            <DigitsField label="No. HP wali / keluarga" name="guardian_phone" defaultValue={host.guardian_phone} maxLength={15} placeholder="08…" error={errors.guardian_phone} />
          </div>
        )}

        <div className="flex justify-end">
          <SubmitButton loading={loading} size="default" className="sm:w-auto">
            Simpan
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function BrandsCard({ host }: { host: HostProfileData }) {
  return (
    <Card id="brand" title="Brand saya" description="Diatur oleh operator.">
      {host.assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kamu belum ditugaskan ke brand mana pun.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {host.assignments.map((assignment) => (
            <li key={assignment.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-foreground">
              {assignment.brand.name}
              {assignment.is_leader && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                  <Crown className="size-3.5" aria-hidden="true" />
                  Leader
                </span>
              )}
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
      notify({ text: updated.message });
      onUpdated(updated);
    }
  );

  async function uploadKtp(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      onUpdated(await hostApi.uploadKtpImage(token, file));
      notify({ text: "Foto KTP tersimpan" });
    } catch (caught) {
      setUploadError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card id="identitas" title="KTP & rekening bank" description="Dibutuhkan untuk penggajian. Disimpan terenkripsi; hanya admin yang bisa melihat nomor lengkapnya.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <DigitsField
          label="Nomor KTP (NIK)"
          name="ktp_number"
          exactLength={16}
          placeholder={current?.ktp_number_masked ?? "16 digit"}
          error={errors.ktp_number}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Bank" name="bank_name" placeholder={current?.bank_name ?? "mis. BCA"} error={errors.bank_name} />
          <DigitsField
            label="Nomor rekening"
            name="bank_account"
            maxLength={20}
            placeholder={current?.bank_account_masked ?? "Hanya angka"}
            error={errors.bank_account}
          />
        </div>
        <TextField
          label="Nama pemilik rekening"
          name="account_holder_name"
          placeholder={current?.account_holder_name ?? "Sesuai yang tertera di rekening"}
          hint="Kosongkan kolom yang tidak ingin diubah."
          error={errors.account_holder_name}
        />

        <div className="flex justify-end">
          <SubmitButton loading={loading} size="default" className="sm:w-auto">
            Simpan
          </SubmitButton>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Foto KTP</p>
          {current?.has_ktp_image ? (
            <p className="flex items-center gap-1 text-xs text-success">
              <CircleCheck className="size-3.5" aria-hidden="true" />
              Sudah diunggah
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Belum diunggah</p>
          )}
        </div>
        <Button asChild variant="outline" className={cn("cursor-pointer", uploading && "pointer-events-none opacity-60")}>
          <label>
            <Upload aria-hidden="true" />
            {uploading ? "Mengunggah…" : current?.has_ktp_image ? "Ganti foto" : "Unggah foto"}
            <input type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={(event) => uploadKtp(event.target.files?.[0])} />
          </label>
        </Button>
      </div>
      {uploadError && <FormAlert tone="error">{uploadError}</FormAlert>}
    </Card>
  );
}
