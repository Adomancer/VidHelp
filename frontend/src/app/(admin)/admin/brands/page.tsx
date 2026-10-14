"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Crown, Pencil, Plus, Tag } from "lucide-react";
import { adminHostsApi, operatorApi, type BrandInput, type BrandSummary } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { statusLabel } from "@/lib/labels";
import { textareaClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import DataTable from "@/components/DataTable";
import DatePicker from "@/components/DatePicker";
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

function brandColumns(onEdit: (brand: BrandSummary) => void): ColumnDef<BrandSummary>[] {
  return [
    { accessorKey: "name", header: "Brand", cell: ({ row }) => <BrandName brand={row.original} /> },
    {
      accessorKey: "target_hours_per_period",
      header: "Target / periode",
      cell: ({ row }) => `${row.original.target_hours_per_period} jam`,
      meta: { cellClassName: "tabular-nums" },
    },
    { accessorKey: "payroll_start_date", header: "Penggajian", cell: ({ row }) => <PayrollStart brand={row.original} /> },
    { accessorKey: "active_hosts_count", header: "Host", meta: { align: "right" } },
    { id: "leader", accessorFn: (brand) => brand.leader?.name ?? "", header: "Leader", cell: ({ row }) => <Leader brand={row.original} /> },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <BrandStatus brand={row.original} /> },
    {
      id: "actions",
      header: () => <span className="sr-only">Aksi</span>,
      enableSorting: false,
      meta: { headClassName: "w-14", cellClassName: "text-right" },
      cell: ({ row }) => (
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onEdit(row.original)} aria-label={`Ubah ${row.original.name}`} title="Ubah">
          <Pencil />
        </Button>
      ),
    },
  ];
}

export default function AdminBrandsPage() {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));
  const [editing, setEditing] = useState<BrandSummary | "new" | null>(null);
  const list = brands.data?.brands;
  const columns = useMemo(() => brandColumns(setEditing), []);

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
          <DataTable
            columns={columns}
            data={list}
            getRowId={(brand) => brand.id}
            className="text-body"
            rowClassName={() => "hover:bg-muted/40"}
            renderMobile={(brand) => (
              <button
                type="button"
                onClick={() => setEditing(brand)}
                className="w-full space-y-2 p-4 text-left outline-none focus-visible:bg-muted/60 active:bg-muted/60"
              >
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
                    <dt className="text-muted-foreground">Penggajian</dt>
                    <dd className="font-medium text-foreground tabular-nums">{brand.payroll_start_date ? formatDate(brand.payroll_start_date) : "Belum"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Host</dt>
                    <dd className="font-medium text-foreground tabular-nums">{brand.active_hosts_count}</dd>
                  </div>
                </dl>
                <Leader brand={brand} />
              </button>
            )}
          />
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

function PayrollStart({ brand }: { brand: BrandSummary }) {
  return brand.payroll_start_date ? (
    <span className="tabular-nums">mulai {formatDate(brand.payroll_start_date)}</span>
  ) : (
    <span className="text-xs text-muted-foreground">belum dimulai</span>
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
          hint="Periode selesai saat jam ini tercapai (mis. 720 jam ≈ sebulan); lalu leader brand mengajukan pembayaran."
        />
        <div className="space-y-1.5">
          <Label htmlFor="payroll_start_date">Mulai penggajian</Label>
          <DatePicker
            id="payroll_start_date"
            name="payroll_start_date"
            defaultValue={brand?.payroll_start_date?.slice(0, 10)}
            clearable
            placeholder="Belum dimulai"
            aria-invalid={errors.payroll_start_date ? true : undefined}
          />
          {errors.payroll_start_date ? <FieldError>{errors.payroll_start_date}</FieldError> : <FieldHint>Awal periode pertama.</FieldHint>}
        </div>
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
