"use client";

import { useState } from "react";
import { adminHostsApi, operatorApi, type BrandInput, type BrandSummary } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import FormAlert from "@/components/FormAlert";
import Modal from "@/components/Modal";
import SelectField from "@/components/SelectField";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";

export default function AdminBrandsPage() {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const [editing, setEditing] = useState<BrandSummary | "new" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Brand</h1>
          <p className="text-sm text-gray-400 mt-1">Host ditugaskan ke brand di halaman Host milik operator.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500"
        >
          Brand baru
        </button>
      </div>

      {editing && (
        <BrandForm
          key={editing === "new" ? "new" : editing.id}
          brand={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            brands.reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {brands.error && <FormAlert tone="error">{brands.error}</FormAlert>}

      <div className={`bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto ${brands.loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-400 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 font-medium">Brand</th>
              <th className="px-4 py-3 font-medium">Target / periode</th>
              <th className="px-4 py-3 font-medium">Siklus pembayaran</th>
              <th className="px-4 py-3 font-medium">Host</th>
              <th className="px-4 py-3 font-medium">Leader</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-gray-200">
            {brands.data?.brands.map((brand) => (
              <tr key={brand.id}>
                <td className="px-4 py-3 text-white">
                  {brand.name}
                  {brand.is_obs && <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs">OBS</span>}
                </td>
                <td className="px-4 py-3">{brand.target_hours_per_period} jam</td>
                <td className="px-4 py-3">
                  {brand.payment_cycle_days} hari
                  <span className="block text-xs text-gray-500">
                    {brand.payroll_start_date ? `mulai ${formatDate(brand.payroll_start_date)}` : "penggajian belum dimulai"}
                  </span>
                </td>
                <td className="px-4 py-3">{brand.active_hosts_count}</td>
                <td className="px-4 py-3">{brand.leader?.name ?? <span className="text-gray-500">—</span>}</td>
                <td className="px-4 py-3">{statusLabel(brand.status)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(brand)}
                    title={`Ubah data ${brand.name}: nama, target jam, siklus pembayaran, dan status`}
                    aria-label={`Ubah ${brand.name}`}
                    className="px-3 py-1.5 rounded-md border border-slate-700 text-gray-300 hover:bg-slate-800"
                  >
                    Ubah
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {brands.data?.brands.length === 0 && <p className="px-4 py-8 text-center text-gray-400">Belum ada brand.</p>}
      </div>
    </div>
  );
}

function BrandForm({ brand, onDone, onCancel }: { brand: BrandSummary | null; onDone: () => void; onCancel: () => void }) {
  const { token } = useAuth();
  const { loading, errors, error, handleSubmit } = useApiForm((data) => {
    const input: BrandInput = {
      name: formValue(data, "name"),
      is_obs: data.get("is_obs") === "on",
      product_knowledge: formValue(data, "product_knowledge") || null,
      target_hours_per_period: Number(formValue(data, "target_hours_per_period")),
      payment_cycle_days: Number(formValue(data, "payment_cycle_days")),
      payroll_start_date: formValue(data, "payroll_start_date") || null,
      status: (formValue(data, "status") || "active") as BrandInput["status"],
    };
    return brand ? adminHostsApi.updateBrand(token, brand.id, input) : adminHostsApi.createBrand(token, input);
  }, onDone);

  return (
    <Modal title={brand ? `Ubah ${brand.name}` : "Brand baru"} onClose={onCancel} wide>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <TextField label="Nama" name="name" defaultValue={brand?.name} required error={errors.name} />
        <TextField
          label="Target jam per periode"
          name="target_hours_per_period"
          type="number"
          min={1}
          defaultValue={brand?.target_hours_per_period}
          required
          error={errors.target_hours_per_period}
        />
        <TextField
          label="Siklus pembayaran (hari)"
          name="payment_cycle_days"
          type="number"
          min={1}
          defaultValue={brand?.payment_cycle_days ?? 14}
          required
          error={errors.payment_cycle_days}
        />
        <TextField
          label="Mulai penggajian (awal periode pertama)"
          name="payroll_start_date"
          type="date"
          defaultValue={brand?.payroll_start_date ?? ""}
          error={errors.payroll_start_date}
        />
        {brand && (
          <SelectField
            label="Status"
            name="status"
            defaultValue={brand.status}
            options={[
              { value: "active", label: "Aktif" },
              { value: "inactive", label: "Nonaktif" },
            ]}
          />
        )}
        <label className="flex items-center gap-2 text-sm text-gray-200 sm:col-span-2">
          <input type="checkbox" name="is_obs" defaultChecked={brand?.is_obs} className="accent-purple-500" />
          Brand OBS (live pakai OBS)
        </label>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="product_knowledge" className="block text-sm font-medium text-gray-200">
            Product knowledge
          </label>
          <textarea
            id="product_knowledge"
            name="product_knowledge"
            rows={8}
            defaultValue={brand?.product_knowledge ?? ""}
            placeholder="Produk, harga, promo, poin penting saat live, link katalog…"
            aria-invalid={errors.product_knowledge ? true : undefined}
            className={`w-full px-4 py-2.5 rounded-xl bg-slate-900/60 border text-white outline-none focus:ring-2 focus:ring-purple-500 ${
              errors.product_knowledge ? "border-red-400" : "border-white/15"
            }`}
          />
          <p className="text-xs text-gray-400">Host yang ditugaskan ke brand ini melihatnya di halaman Brand mereka. Link bisa diklik.</p>
          {errors.product_knowledge && <p className="text-sm text-red-300">{errors.product_knowledge}</p>}
        </div>
        <div className="flex gap-3 sm:col-span-2">
          <div className="w-40">
            <SubmitButton loading={loading}>Simpan</SubmitButton>
          </div>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-gray-300 hover:bg-slate-800">
            Batal
          </button>
        </div>
      </form>
    </Modal>
  );
}
