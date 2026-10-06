"use client";

import { useState } from "react";
import Link from "next/link";
import { adminHostsApi, errorMessage, operatorApi, type AdminHostDetail, type RateCategory } from "@/lib/api";
import { formatDate, formatRupiah, formatTenure } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import AssignmentEditor from "./AssignmentEditor";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import DigitsField from "./DigitsField";
import FormAlert from "./FormAlert";
import SelectField from "./SelectField";
import TextField from "./TextField";
import UserAvatar from "./UserAvatar";

const FORM_ID = "host-settings";

interface HostDetailDialogProps {
  hostId: string;
  onClose: () => void;
  /** After saving the settings (closes the dialog) or changing brands (stays open). */
  onChanged: (message?: string) => void;
}

/**
 * Admin: one host in a dialog over the list. Contact numbers, join date and rate level
 * (saved with the footer button), KTP & bank as filled in by the host, and brands.
 */
export default function HostDetailDialog({ hostId, onClose, onChanged }: HostDetailDialogProps) {
  const { token } = useAuth();
  const [dirty, setDirty] = useState(false);
  const host = useApiData(`host-${hostId}`, () => adminHostsApi.host(token, hostId));
  const rates = useApiData("rates", () => adminHostsApi.rateCategories(token));
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const detail = host.data?.host;

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      adminHostsApi.updateHost(token, hostId, {
        phone: formValue(data, "phone") || null,
        guardian_phone: formValue(data, "guardian_phone") || null,
        join_date: formValue(data, "join_date"),
        rate_category_id: formValue(data, "rate_category_id") || null,
      }),
    ({ host: updated }) => {
      setDirty(false);
      onChanged(`Data ${updated.user.name} disimpan`);
      onClose();
    }
  );

  return (
    <Dialog
      size="lg"
      onClose={onClose}
      dirty={dirty && !loading}
      title={
        detail ? (
          <span className="flex items-center gap-3">
            <UserAvatar user={detail.user} size="w-10 h-10" />
            <span className="min-w-0">
              <span className="block truncate">{detail.user.name}</span>
              <span className="block text-sm font-normal text-muted truncate">{detail.user.email}</span>
            </span>
          </span>
        ) : (
          "Host"
        )
      }
      footer={
        <>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-body hover:bg-surface-2">
            Batal
          </button>
          <button
            type="submit"
            form={FORM_ID}
            disabled={loading || !detail || !rates.data}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover disabled:opacity-40"
          >
            {loading ? "Menyimpan…" : "Simpan"}
          </button>
        </>
      }
    >
      {host.error && <FormAlert tone="error">{host.error}</FormAlert>}
      {!detail && !host.error && <p className="text-sm text-muted">Memuat…</p>}

      {detail && (
        <div className="space-y-6">
          <Section title="Pengaturan host">
            {/* Wait for the levels: the rate select's defaultValue only applies to options present on first render */}
            {rates.data ? (
              <form id={FORM_ID} onSubmit={handleSubmit} onChange={() => setDirty(true)} className="grid gap-4 sm:grid-cols-2" noValidate>
                {error && (
                  <div className="sm:col-span-2">
                    <FormAlert tone="error">{error}</FormAlert>
                  </div>
                )}
                <DigitsField label="No. HP" name="phone" defaultValue={detail.phone} maxLength={15} placeholder="08…" error={errors.phone} />
                <DigitsField label="No. HP wali" name="guardian_phone" defaultValue={detail.guardian_phone} maxLength={15} placeholder="08…" error={errors.guardian_phone} />
                <TextField label="Tanggal bergabung" name="join_date" type="date" defaultValue={detail.join_date.slice(0, 10)} error={errors.join_date} />
                <div className="space-y-1">
                  <span className="block text-sm font-medium text-body">Status</span>
                  <p className="text-sm text-heading">{statusLabel(detail.status)}</p>
                  <p className="text-xs text-muted">
                    Mengikuti status akun. Ubah di halaman{" "}
                    <Link href="/admin/users" className="text-accent hover:text-heading">
                      Pengguna
                    </Link>
                    .
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <RateSelect host={detail} rates={rates.data.rate_categories} error={errors.rate_category_id} />
                </div>
              </form>
            ) : rates.error ? (
              <FormAlert tone="error">{rates.error}</FormAlert>
            ) : (
              <p className="text-sm text-muted">Memuat…</p>
            )}
          </Section>

          <Section title="KTP & bank" description="Diisi oleh host. Hanya admin yang bisa melihat data ini.">
            <SensitiveData host={detail} />
          </Section>

          <Section title="Brand" description="★ Leader — satu brand maksimal punya satu leader. Perubahan brand langsung tersimpan.">
            {brands.data ? (
              <AssignmentEditor
                hostId={detail.id}
                assignments={detail.assignments}
                brands={brands.data.brands}
                onChanged={() => {
                  host.reload();
                  onChanged();
                }}
              />
            ) : (
              <p className="text-sm text-muted">Memuat…</p>
            )}
          </Section>
        </div>
      )}
    </Dialog>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="border-b border-stroke pb-2">
        <h3 className="text-sm font-semibold text-heading">{title}</h3>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function RateSelect({ host, rates, error }: { host: AdminHostDetail; rates: RateCategory[]; error?: string }) {
  const current = host.rate_category ? `${host.rate_category.name}, ${formatRupiah(host.rate_category.rate_per_hour)}/jam` : "belum ada";

  return (
    <>
      <SelectField
        label="Level tarif"
        name="rate_category_id"
        defaultValue={host.rate_category_overridden ? (host.rate_category_id ?? "") : ""}
        error={error}
        options={[
          { value: "", label: "Otomatis sesuai masa kerja" },
          ...rates.map((rate) => ({ value: rate.id, label: `${rate.name} · ${formatRupiah(rate.rate_per_hour)}/jam (diatur manual)` })),
        ]}
      />
      <p className="text-xs text-muted mt-1">
        Saat ini: {current} · di agensi {formatTenure(host.join_date)} (sejak {formatDate(host.join_date)})
      </p>
    </>
  );
}

function SensitiveData({ host }: { host: AdminHostDetail }) {
  const { token } = useAuth();
  const [ktpUrl, setKtpUrl] = useState<string | null>(null);
  const [ktpError, setKtpError] = useState<string | null>(null);
  const data = host.sensitive_data;

  async function showKtp() {
    try {
      setKtpUrl(await adminHostsApi.ktpImageUrl(token, host.id));
    } catch (caught) {
      setKtpError(errorMessage(caught));
    }
  }

  const rows: [string, string | null | undefined][] = [
    ["Nomor KTP", data?.ktp_number],
    ["Bank", data?.bank_name],
    ["Nomor rekening", data?.bank_account],
    ["Nama pemilik rekening", data?.account_holder_name],
  ];

  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-surface-2 px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-heading font-mono">{value || <span className="text-faint font-sans">belum diisi</span>}</dd>
          </div>
        ))}
      </dl>

      {ktpError && <FormAlert tone="error">{ktpError}</FormAlert>}
      {data?.has_ktp_image ? (
        ktpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- private blob URL
          <img src={ktpUrl} alt="Foto KTP" className="max-h-80 rounded-lg border border-stroke-strong" />
        ) : (
          <button type="button" onClick={showKtp} className="px-4 py-2 rounded-lg border border-stroke-strong text-body text-sm hover:bg-surface-2">
            Lihat foto KTP
          </button>
        )
      ) : (
        <p className="text-sm text-faint">Belum ada foto KTP.</p>
      )}
    </div>
  );
}
