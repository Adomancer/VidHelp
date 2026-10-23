"use client";

import { useState } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";
import { adminHostsApi, operatorApi, type AdminHostDetail, type RateCategory } from "@/lib/api";
import { formatDate, formatRupiah, formatTenure } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import AssignmentEditor from "./AssignmentEditor";
import { useAuth } from "./AuthProvider";
import DatePicker from "./DatePicker";
import Dialog from "./Dialog";
import DigitsField from "./DigitsField";
import { FieldError } from "./FieldMessage";
import FormAlert from "./FormAlert";
import { ListSkeleton } from "./Loading";
import SelectField from "./SelectField";
import StatusBadge from "./StatusBadge";
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
  const host = useApiData(`admin-host-${hostId}`, () => adminHostsApi.host(token, hostId));
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
      placement="side"
      onClose={onClose}
      dirty={dirty && !loading}
      title={
        detail ? (
          <span className="flex items-center gap-3">
            <UserAvatar user={detail.user} size="size-10 text-sm" />
            <span className="min-w-0">
              <span className="block truncate">{detail.user.name}</span>
              <span className="block truncate text-sm font-normal text-muted-foreground">{detail.user.email}</span>
            </span>
          </span>
        ) : (
          "Host"
        )
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form={FORM_ID} disabled={loading || !detail || !rates.data}>
            {loading ? "Menyimpan…" : "Simpan"}
          </Button>
        </>
      }
    >
      {host.error && <FormAlert tone="error">{host.error}</FormAlert>}
      {!detail && !host.error && <ListSkeleton rows={4} />}

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
                <DigitsField
                  label="No. HP wali"
                  name="guardian_phone"
                  defaultValue={detail.guardian_phone}
                  maxLength={15}
                  placeholder="08…"
                  error={errors.guardian_phone}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="join_date">Tanggal bergabung</Label>
                  {/* A hidden input doesn't fire the form's change event, so mark the form as edited here */}
                  <DatePicker
                    id="join_date"
                    name="join_date"
                    defaultValue={detail.join_date.slice(0, 10)}
                    onChange={() => setDirty(true)}
                    captionLayout="dropdown"
                    aria-invalid={errors.join_date ? true : undefined}
                    aria-describedby={errors.join_date ? "join_date-error" : undefined}
                  />
                  <FieldError id="join_date-error">{errors.join_date}</FieldError>
                </div>
                <div className="space-y-1.5">
                  <span className="block text-sm font-medium text-foreground">Status</span>
                  <StatusBadge tone={detail.status === "active" ? "success" : detail.status === "banned" ? "danger" : "neutral"} dot>
                    {statusLabel(detail.status)}
                  </StatusBadge>
                  <p className="text-xs text-muted-foreground">
                    Mengikuti status akun. Ubah di halaman{" "}
                    <Link href="/admin/users" className="font-medium text-brand hover:underline">
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
              <ListSkeleton rows={2} />
            )}
          </Section>

          <Section title="KTP & bank" description="Diisi oleh host. Hanya admin yang bisa melihat data ini.">
            <SensitiveData host={detail} />
          </Section>

          <Section
            title="Brand"
            description={
              <span className="inline-flex flex-wrap items-center gap-1">
                <Crown className="size-3.5 text-warning" aria-hidden="true" />
                Leader: satu brand maksimal punya satu leader. Perubahan brand langsung tersimpan.
              </span>
            }
          >
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
              <ListSkeleton rows={2} />
            )}
          </Section>
        </div>
      )}
    </Dialog>
  );
}

function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="border-b border-border pb-2.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
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
      <p className="mt-1.5 text-xs text-muted-foreground">
        Saat ini: {current} · di agensi {formatTenure(host.join_date)} (sejak {formatDate(host.join_date)})
      </p>
    </>
  );
}

function SensitiveData({ host }: { host: AdminHostDetail }) {
  const data = host.sensitive_data;

  const rows: [string, string | null | undefined][] = [
    ["Nomor KTP", data?.ktp_number],
    ["Bank", data?.bank_name],
    ["Nomor rekening", data?.bank_account],
    ["Nama pemilik rekening", data?.account_holder_name],
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 text-sm text-foreground tabular-nums">{value || <span className="text-faint">belum diisi</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
