"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { adminHostsApi, errorMessage, operatorApi, type AdminHostDetail, type RateCategory } from "@/lib/api";
import { formatDate, formatRupiah, formatTenure } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import AssignmentEditor from "@/components/AssignmentEditor";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";
import SelectField from "@/components/SelectField";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";
import UserAvatar from "@/components/UserAvatar";

export default function AdminHostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const host = useApiData(id, () => adminHostsApi.host(token, id));
  const rates = useApiData("rates", () => adminHostsApi.rateCategories(token));
  const brands = useApiData("brands", () => operatorApi.brands(token));

  if (host.error && !host.data) return <FormAlert tone="error">{host.error}</FormAlert>;
  if (!host.data) return <p className="text-gray-400">Memuat…</p>;

  const detail = host.data.host;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/admin/hosts" className="text-sm text-purple-300 hover:text-white">
        ← Semua host
      </Link>

      <div className="flex items-center gap-4">
        <UserAvatar user={detail.user} size="w-14 h-14" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white truncate">{detail.user.name}</h1>
          <p className="text-sm text-gray-400 truncate">{detail.user.email}</p>
        </div>
      </div>

      {/* Wait for the levels: the rate select's defaultValue only applies to options present on first render */}
      {rates.data ? (
        <SettingsForm host={detail} rates={rates.data.rate_categories} onSaved={(updated) => host.setData({ host: updated })} />
      ) : (
        <Card title="Pengaturan host">
          {rates.error ? <FormAlert tone="error">{rates.error}</FormAlert> : <p className="text-sm text-gray-400">Memuat…</p>}
        </Card>
      )}

      <SensitiveCard host={detail} />

      <Card title="Brand" description="★ Leader — satu brand maksimal punya satu leader.">
        {brands.data && (
          <AssignmentEditor hostId={detail.id} assignments={detail.assignments} brands={brands.data.brands} onChanged={host.reload} />
        )}
      </Card>
    </div>
  );
}

function SettingsForm({ host, rates, onSaved }: { host: AdminHostDetail; rates: RateCategory[]; onSaved: (host: AdminHostDetail) => void }) {
  const { token } = useAuth();
  const [saved, setSaved] = useState(false);

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      adminHostsApi.updateHost(token, host.id, {
        phone: formValue(data, "phone") || null,
        guardian_phone: formValue(data, "guardian_phone") || null,
        join_date: formValue(data, "join_date"),
        rate_category_id: formValue(data, "rate_category_id") || null,
      }),
    ({ host: updated }) => {
      setSaved(true);
      onSaved(updated);
    }
  );

  const current = host.rate_category ? `${host.rate_category.name}, ${formatRupiah(host.rate_category.rate_per_hour)}/jam` : "belum ada";

  return (
    <Card title="Pengaturan host">
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        {saved && (
          <div className="sm:col-span-2">
            <FormAlert tone="success">Tersimpan.</FormAlert>
          </div>
        )}

        <TextField label="No. HP" name="phone" type="tel" defaultValue={host.phone ?? ""} error={errors.phone} />
        <TextField label="No. HP wali" name="guardian_phone" type="tel" defaultValue={host.guardian_phone ?? ""} error={errors.guardian_phone} />
        <TextField label="Tanggal bergabung" name="join_date" type="date" defaultValue={host.join_date.slice(0, 10)} error={errors.join_date} />
        <div className="space-y-1">
          <span className="block text-sm font-medium text-gray-200">Status</span>
          <p className="text-sm text-white">{statusLabel(host.status)}</p>
          <p className="text-xs text-gray-400">
            Mengikuti status akun. Nonaktifkan atau arsipkan di halaman{" "}
            <Link href="/admin/users" className="text-purple-300 hover:text-white">
              Pengguna
            </Link>
            .
          </p>
        </div>
        <div className="sm:col-span-2">
          <SelectField
            label="Level tarif"
            name="rate_category_id"
            defaultValue={host.rate_category_overridden ? (host.rate_category_id ?? "") : ""}
            error={errors.rate_category_id}
            options={[
              { value: "", label: "Otomatis sesuai masa kerja" },
              ...rates.map((rate) => ({ value: rate.id, label: `${rate.name} (diatur manual)` })),
            ]}
          />
          <p className="text-xs text-gray-400 mt-1">
            Saat ini: {current} · di agensi {formatTenure(host.join_date)} (sejak {formatDate(host.join_date)})
          </p>
        </div>

        <div className="w-40">
          <SubmitButton loading={loading}>Simpan</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function SensitiveCard({ host }: { host: AdminHostDetail }) {
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
    <Card title="KTP & bank" description="Diisi oleh host. Hanya admin yang bisa melihat data ini.">
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-gray-400">{label}</dt>
            <dd className="text-white font-mono">{value || <span className="text-gray-500 font-sans">belum diisi</span>}</dd>
          </div>
        ))}
      </dl>

      {ktpError && <FormAlert tone="error">{ktpError}</FormAlert>}
      {data?.has_ktp_image ? (
        ktpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- private blob URL
          <img src={ktpUrl} alt="Foto KTP" className="max-h-80 rounded-lg border border-slate-700" />
        ) : (
          <button type="button" onClick={showKtp} className="px-4 py-2 rounded-lg border border-slate-700 text-gray-300 text-sm hover:bg-slate-800">
            Lihat foto KTP
          </button>
        )
      ) : (
        <p className="text-sm text-gray-500">Belum ada foto KTP.</p>
      )}
    </Card>
  );
}
