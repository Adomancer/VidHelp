"use client";

import { useState } from "react";
import { Crown, Pencil, Plus, Tag } from "lucide-react";
import { adminHostsApi, operatorApi, type BrandInput, type BrandSummary } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { textareaClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { FieldError, FieldHint } from "@/components/FieldMessage";
import FormActions from "@/components/FormActions";
import FormAlert from "@/components/FormAlert";
import { RefreshBar, TableSkeleton } from "@/components/Loading";
import Modal from "@/components/Modal";
import PageHeader from "@/components/PageHeader";
import SelectField from "@/components/SelectField";
import StatusBadge from "@/components/StatusBadge";
import TextField from "@/components/TextField";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function AdminBrandsPage() {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const [editing, setEditing] = useState<BrandSummary | "new" | null>(null);
  const list = brands.data?.brands;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brand"
        description="Target jam, siklus pembayaran dan product knowledge tiap brand. Host ditugaskan ke brand di halaman Host."
        actions={
          <Button type="button" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            Brand baru
          </Button>
        }
      />

      {brands.error && <ErrorState message={brands.error} onRetry={brands.reload} />}

      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <RefreshBar active={brands.loading && Boolean(list)} />
        {!list && !brands.error && <TableSkeleton rows={4} columns={5} />}
        {list?.length === 0 && (
          <EmptyState
            icon={Tag}
            title="Belum ada brand"
            description="Tambahkan brand pertama untuk mulai menyusun jadwal dan penggajian."
            action={
              <Button type="button" variant="outline" onClick={() => setEditing("new")}>
                <Plus aria-hidden="true" />
                Brand baru
              </Button>
            }
          />
        )}

        {list && list.length > 0 && (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <th className="px-4 py-3 font-medium">Target / periode</th>
                  <th className="px-4 py-3 font-medium">Siklus pembayaran</th>
                  <th className="px-4 py-3 text-right font-medium">Host</th>
                  <th className="px-4 py-3 font-medium">Leader</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="w-14 px-4 py-3">
                    <span className="sr-only">Aksi</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-body">
                {list.map((brand) => (
                  <tr key={brand.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <BrandName brand={brand} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">{brand.target_hours_per_period} jam</td>
                    <td className="px-4 py-3">
                      <Cycle brand={brand} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{brand.active_hosts_count}</td>
                    <td className="px-4 py-3">
                      <Leader brand={brand} />
                    </td>
                    <td className="px-4 py-3">
                      <BrandStatus brand={brand} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditing(brand)} aria-label={`Ubah ${brand.name}`} title="Ubah">
                        <Pencil />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-border md:hidden">
              {list.map((brand) => (
                <li key={brand.id}>
                  <button type="button" onClick={() => setEditing(brand)} className="w-full space-y-2 p-4 text-left outline-none active:bg-muted/60 focus-visible:bg-muted/60">
                    <div className="flex items-start justify-between gap-3">
                      <BrandName brand={brand} />
                      <BrandStatus brand={brand} />
                    </div>
                    <dl className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Target</dt>
                        <dd className="font-medium text-foreground tabular-nums">{brand.target_hours_per_period} jam</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Siklus</dt>
                        <dd className="font-medium text-foreground tabular-nums">{brand.payment_cycle_days} hari</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Host</dt>
                        <dd className="font-medium text-foreground tabular-nums">{brand.active_hosts_count}</dd>
                      </div>
                    </dl>
                    <Leader brand={brand} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {editing && (
        <BrandForm
          key={editing === "new" ? "new" : editing.id}
          brand={editing === "new" ? null : editing}
          onDone={(name) => {
            setEditing(null);
            notify({ text: editing === "new" ? `Brand ${name} dibuat` : `Brand ${name} disimpan` });
            brands.reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BrandName({ brand }: { brand: BrandSummary }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-brand" aria-hidden="true">
        {brand.name.charAt(0).toUpperCase()}
      </span>
      <span className="truncate font-medium text-foreground">{brand.name}</span>
      {brand.is_obs && (
        <StatusBadge tone="info" className="h-5 px-1.5 text-[10px]">
          OBS
        </StatusBadge>
      )}
    </div>
  );
}

function Cycle({ brand }: { brand: BrandSummary }) {
  return (
    <>
      <span className="tabular-nums">{brand.payment_cycle_days} hari</span>
      <span className="block text-xs text-muted-foreground">{brand.payroll_start_date ? `mulai ${formatDate(brand.payroll_start_date)}` : "penggajian belum dimulai"}</span>
    </>
  );
}

function Leader({ brand }: { brand: BrandSummary }) {
  if (!brand.leader) return <span className="text-xs text-faint">Belum ada leader</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Crown className="size-3.5 text-warning" aria-label="Leader" />
      {brand.leader.name}
    </span>
  );
}

function BrandStatus({ brand }: { brand: BrandSummary }) {
  return (
    <StatusBadge tone={brand.status === "active" ? "success" : "neutral"} dot>
      {statusLabel(brand.status)}
    </StatusBadge>
  );
}

function BrandForm({ brand, onDone, onCancel }: { brand: BrandSummary | null; onDone: (name: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => {
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
    },
    (_result, form) => onDone(String(new FormData(form).get("name") ?? ""))
  );

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
          label="Mulai penggajian"
          name="payroll_start_date"
          type="date"
          defaultValue={brand?.payroll_start_date ?? ""}
          hint="Awal periode pertama."
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
        <label className="flex items-center gap-2.5 self-end rounded-lg border border-border px-3 py-2.5 text-sm text-body sm:col-span-2">
          <input type="checkbox" name="is_obs" defaultChecked={brand?.is_obs} className="size-4 accent-primary" />
          Brand OBS <span className="text-muted-foreground">(live pakai OBS)</span>
        </label>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="product_knowledge">Product knowledge</Label>
          <textarea
            id="product_knowledge"
            name="product_knowledge"
            rows={8}
            defaultValue={brand?.product_knowledge ?? ""}
            placeholder="Produk, harga, promo, poin penting saat live, link katalog…"
            aria-invalid={errors.product_knowledge ? true : undefined}
            className={textareaClass}
          />
          {errors.product_knowledge ? (
            <FieldError>{errors.product_knowledge}</FieldError>
          ) : (
            <FieldHint>Host yang ditugaskan ke brand ini melihatnya di halaman Brand mereka. Link bisa diklik.</FieldHint>
          )}
        </div>
        <FormActions loading={loading} submitLabel="Simpan" onCancel={onCancel} />
      </form>
    </Modal>
  );
}
