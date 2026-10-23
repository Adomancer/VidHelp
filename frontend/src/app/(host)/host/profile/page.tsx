"use client";

import { useState } from "react";
import { Camera, Clock, Crown, LogOut, XCircle } from "lucide-react";
import { errorMessage, hostApi, type MyProfile, type MyProfileChange } from "@/lib/api";
import { acceptOf, PHOTO_UPLOAD, uploadProblem } from "@/lib/files";
import { formatDate, formatTenure } from "@/lib/format";
import { roleLabel } from "@/lib/labels";
import { useApiData } from "@/lib/useApiData";
import { useNow } from "@/lib/useNow";
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
          {host && profile.data?.profile_change && <ChangeStatus change={profile.data.profile_change} onUpdated={applyUpdate} />}
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

  async function upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = ""; // picking the same file again (after an error) must fire onChange again
    if (!file) return;
    const problem = uploadProblem(file, PHOTO_UPLOAD);
    setError(problem);
    if (problem) return;
    setUploading(true);
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
          <input type="file" accept={acceptOf(PHOTO_UPLOAD)} className="sr-only" disabled={uploading} onChange={(event) => upload(event.target)} />
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
    (form) => {
      if (!host) return hostApi.updateProfile(token, { name: formValue(form, "name") });

      // Only what was edited here: sending an unchanged field would drop that field from a pending
      // request (the server treats "same as saved" as "never mind"), e.g. a phone change sent earlier
      // (compared as the fields show them: phone fields keep digits only)
      const digits = (value: string | null) => (value ?? "").replace(/\D/g, "");
      const saved = { name: data.user.name, phone: digits(host.phone), guardian_phone: digits(host.guardian_phone) };
      const changed = (Object.keys(saved) as (keyof typeof saved)[])
        .map((field) => [field, formValue(form, field).trim()] as const)
        .filter(([field, value]) => value !== saved[field]);
      return hostApi.updateProfile(token, Object.fromEntries(changed.map(([field, value]) => [field, value || null])));
    },
    (updated, form) => {
      // For hosts nothing changed yet: show the saved data again (what was sent is in the request card)
      if (host) form.reset();
      notify({ text: updated.message });
      onUpdated(updated);
    }
  );

  return (
    <Card id="data-pribadi" title="Data pribadi" description={host ? "Perubahan dikirim ke admin dan berlaku setelah disetujui." : undefined}>
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
            {host ? "Kirim untuk disetujui" : "Simpan"}
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}

const sameDay = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

/**
 * Where my latest personal data change stands: waiting for an admin (with what I asked for),
 * rejected (with why), or approved lately.
 */
function ChangeStatus({ change, onUpdated }: { change: MyProfileChange; onUpdated: (profile: MyProfile) => void }) {
  const { token } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const now = useNow(60 * 60_000);
  const recent = change.reviewed_at && now.getTime() - new Date(change.reviewed_at).getTime() < 7 * 86_400_000;

  async function cancel() {
    setCancelling(true);
    try {
      const updated = await hostApi.cancelChange(token, change.id);
      notify({ text: updated.message });
      onUpdated(updated);
    } catch (caught) {
      notify({ text: errorMessage(caught), tone: "error" });
    } finally {
      setCancelling(false);
    }
  }

  if (change.status === "rejected") {
    return (
      <FormAlert tone="error">
        <span className="font-medium">Perubahan data ditolak admin</span>
        {change.reviewed_at && ` (${sameDay(change.reviewed_at)})`}: {change.review_note}. Perbaiki lalu kirim lagi.
      </FormAlert>
    );
  }

  if (change.status === "approved") {
    return recent ? (
      <FormAlert tone="success">Perubahan data disetujui admin{change.reviewed_at && ` pada ${sameDay(change.reviewed_at)}`}.</FormAlert>
    ) : null;
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <Clock className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-foreground">Menunggu persetujuan admin</p>
            <p className="text-sm text-muted-foreground">
              Dikirim {sameDay(change.created_at)}. Data di bawah belum berubah sampai disetujui. Perubahan lain yang kamu kirim ikut masuk ke permintaan ini.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={cancelling}>
          <XCircle aria-hidden="true" />
          {cancelling ? "Membatalkan…" : "Batalkan permintaan"}
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm sm:grid-cols-2">
        {change.fields.map((field) => (
          <div key={field.field} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{field.label}</dt>
            <dd className="truncate font-medium text-foreground">{field.value ?? <span className="font-normal text-muted-foreground">dikosongkan</span>}</dd>
          </div>
        ))}
      </dl>
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

  return (
    <Card
      id="identitas"
      title="KTP & rekening bank"
      description="Dibutuhkan untuk penggajian. Disimpan terenkripsi; hanya admin yang bisa melihat nomor lengkapnya. Perubahan berlaku setelah disetujui admin."
    >
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
            Kirim untuk disetujui
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
