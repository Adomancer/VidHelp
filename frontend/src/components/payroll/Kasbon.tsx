"use client";

import { useState } from "react";
import { HandCoins, Plus } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { errorMessage, payrollApi, type CashAdvance } from "@/lib/api";
import { formatDate, formatRupiah } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "../AuthProvider";
import ConfirmDialog from "../ConfirmDialog";
import EmptyState from "../EmptyState";
import ErrorState from "../ErrorState";
import { FieldError } from "../FieldMessage";
import FormActions from "../FormActions";
import FormAlert from "../FormAlert";
import { CardsSkeleton } from "../Loading";
import Modal from "../Modal";
import RupiahInput from "../RupiahInput";
import SearchableSelect from "../SearchableSelect";
import { NativeSelect } from "../SelectField";
import StatusBadge from "../StatusBadge";
import { notify } from "../Toast";
import { InlineAction } from "./PeriodDetail";
import { useCanManageFinance } from "./shared";

const advanceTypes = { early_payment: "Gaji di muka", loan: "Pinjaman" } as const;

function installmentColor(installment: CashAdvance["installments"][number]): string {
  if (installment.status === "deducted") return "bg-success";
  if (installment.status === "settled") return "bg-info";
  return installment.skip_count > 0 ? "bg-warning" : "bg-secondary";
}

export function Kasbon() {
  const { token } = useAuth();
  // "Semua" is "" for the API and "all" in the URL
  const [statusParam, setStatusParam] = useQueryState("kasbon", parseAsStringLiteral(["open", "paid", "all"] as const).withDefault("open"));
  const status = statusParam === "all" ? "" : statusParam;
  const setStatus = (next: typeof status) => void setStatusParam(next || "all");
  const advances = useApiData(`payroll-advances-${status}`, () => payrollApi.advances(token, status), { keepPrevious: true });
  const canManage = useCanManageFinance();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<CashAdvance | null>(null);
  const list = advances.data?.advances;

  async function act(action: () => Promise<{ message: string }>) {
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    advances.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NativeSelect wrapperClassName="w-48" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Status kasbon">
          <option value="open">Masih dicicil</option>
          <option value="paid">Sudah lunas</option>
          <option value="">Semua</option>
        </NativeSelect>
        {canManage && (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Catat kasbon
          </Button>
        )}
      </div>

      {creating && (
        <AdvanceForm
          onDone={(message) => {
            setCreating(false);
            act(async () => ({ message }));
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {advances.error && <ErrorState message={advances.error} onRetry={advances.reload} />}
      {!list && !advances.error && <CardsSkeleton count={2} />}

      {list?.length === 0 && (
        <div className="rounded-xl border border-dashed border-input bg-card/50">
          <EmptyState icon={HandCoins} title="Tidak ada kasbon" />
        </div>
      )}
      <ul className={cn("grid gap-3 xl:grid-cols-2", advances.loading && list && "opacity-60")}>
        {list?.map((advance) => {
          const paidCount = advance.installments.filter((installment) => installment.status !== "scheduled").length;
          const skipped = advance.installments.find((installment) => installment.status === "scheduled" && installment.skip_count > 0);

          return (
            <li key={advance.id} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-xs dark:shadow-none">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {advance.host.user.name}
                    <span className="font-semibold tabular-nums"> · {formatRupiah(advance.total_amount)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {advanceTypes[advance.type]} · {formatDate(advance.requested_at)}
                    {advance.brand ? ` · ${advance.brand.name}` : ""}
                    {advance.notes ? ` · ${advance.notes}` : ""}
                  </p>
                </div>
                {advance.status === "paid" ? (
                  <StatusBadge tone="success">Lunas</StatusBadge>
                ) : (
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {paidCount}/{advance.installment_count} cicilan
                    <span className="block text-sm font-semibold text-foreground">sisa {formatRupiah(advance.remaining_amount)}</span>
                  </span>
                )}
              </div>
              <div className="flex gap-1" aria-label={`${paidCount} dari ${advance.installment_count} cicilan terbayar`}>
                {advance.installments.map((installment) => (
                  <span
                    key={installment.id}
                    title={`${installment.seq}: ${formatRupiah(installment.amount)}${installment.skip_count > 0 ? ` · dilewati ${installment.skip_count}×` : ""}`}
                    className={cn("h-2 flex-1 rounded-full", installmentColor(installment))}
                  />
                ))}
              </div>
              {skipped && (
                <FormAlert tone="warning">
                  Cicilan {skipped.seq} ({formatRupiah(skipped.amount)}) dilewati di {skipped.skip_count} slip karena gaji tidak cukup. Pertimbangkan menjadwal ulang
                  jadi cicilan yang lebih kecil.
                </FormAlert>
              )}
              {advance.settled_at && (
                <p className="text-xs text-muted-foreground">
                  Dilunasi langsung pada {formatDate(advance.settled_at)}
                  {advance.settler ? ` (dicatat oleh ${advance.settler.name})` : ""}
                  {advance.settled_note ? ` · ${advance.settled_note}` : ""}
                </p>
              )}
              {canManage && (advance.status !== "paid" || paidCount === 0) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {advance.status !== "paid" && (
                    <>
                      <InlineAction
                        small
                        label="Dilunasi langsung"
                        placeholder="Catatan (opsional), mis. tunai tgl 3 Okt"
                        submitLabel="Tandai lunas"
                        onSubmit={(note) => act(() => payrollApi.settleAdvance(token, advance.id, note || null))}
                      />
                      <InlineAction
                        small
                        label="Jadwal ulang"
                        placeholder="Jumlah cicilan"
                        submitLabel="Bagi sisanya"
                        type="number"
                        required
                        onSubmit={(count) => act(() => payrollApi.rescheduleAdvance(token, advance.id, Number(count)))}
                      />
                    </>
                  )}
                  {paidCount === 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setRemoving(advance)}
                      className="ml-auto text-destructive hover:text-destructive max-md:h-10 max-md:px-3"
                    >
                      Hapus (salah catat)
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {removing && (
        <ConfirmDialog
          title="Hapus kasbon ini?"
          confirmLabel="Hapus kasbon"
          cancelLabel="Kembali"
          onConfirm={() => act(() => payrollApi.removeAdvance(token, removing.id))}
          onClose={() => setRemoving(null)}
        >
          {advanceTypes[removing.type]} {removing.host.user.name} sebesar {formatRupiah(removing.total_amount)}. Belum ada cicilan yang dipotong.
        </ConfirmDialog>
      )}
    </div>
  );
}

function AdvanceForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const hosts = useApiData("payroll-hosts-all", () => payrollApi.hosts(token));
  const [chosenId, setChosenId] = useState("");
  // The select shows the first host until one is picked
  const hostId = chosenId || hosts.data?.hosts[0]?.host_id || "";
  const limit = useApiData(`payroll-advance-limit-${hostId}`, () => payrollApi.advanceLimit(token, hostId), { enabled: hostId !== "" });

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      payrollApi.createAdvance(token, {
        host_id: formValue(data, "host_id"),
        type: formValue(data, "type") as "early_payment" | "loan",
        total_amount: Number(formValue(data, "total_amount")),
        installment_count: Number(formValue(data, "installment_count")),
        notes: formValue(data, "notes") || null,
      }),
    ({ message }) => onDone(message)
  );

  return (
    <Modal title="Catat kasbon" description="Dicicil sama rata dari slip gaji host berikutnya (brand apa pun)." onClose={onCancel}>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="advance-host">Host</Label>
          {hosts.error && <ErrorState message={hosts.error} onRetry={hosts.reload} />}
          {/* Hundreds of hosts: type to find one; the hidden field sends the choice with the form */}
          <SearchableSelect
            id="advance-host"
            value={hostId}
            onChange={setChosenId}
            options={hosts.data?.hosts.map((host) => ({ value: host.host_id, label: host.name })) ?? []}
            placeholder="Pilih host…"
          />
          <input type="hidden" name="host_id" value={hostId} />
          <FieldError>{errors.host_id}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advance-type">Jenis</Label>
          <NativeSelect id="advance-type" name="type">
            <option value="loan">Pinjaman</option>
            <option value="early_payment">Gaji di muka</option>
          </NativeSelect>
          <FieldError>{errors.type}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advance-amount">Jumlah</Label>
          <RupiahInput
            id="advance-amount"
            name="total_amount"
            placeholder="0"
            aria-invalid={errors.total_amount ? true : undefined}
            aria-describedby="advance-limit"
          />
          <FieldError>{errors.total_amount}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="advance-installments">Jumlah cicilan</Label>
          <input id="advance-installments" name="installment_count" type="number" min={1} max={24} defaultValue={1} className={cn(inputClass, "tabular-nums")} />
          <FieldError>{errors.installment_count}</FieldError>
        </div>
        <p id="advance-limit" className={cn("text-xs text-muted-foreground sm:col-span-2", limit.loading && "opacity-60")}>
          {!limit.data
            ? "Kasbon berjalan tidak boleh melebihi gaji bulanan host menurut jadwalnya."
            : limit.data.limit.monthly_salary === 0
              ? "Host ini belum punya jadwal aktif atau tarif, jadi belum bisa kasbon."
              : `Bisa kasbon sampai ${formatRupiah(limit.data.limit.available)}: gaji bulanan dari jadwal ${formatRupiah(limit.data.limit.monthly_salary)}, kasbon berjalan ${formatRupiah(limit.data.limit.outstanding)}.`}
        </p>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="advance-notes">
            Catatan <span className="font-normal text-muted-foreground">(opsional)</span>
          </Label>
          <input id="advance-notes" name="notes" maxLength={255} className={inputClass} />
          <FieldError>{errors.notes}</FieldError>
        </div>
        <FormActions loading={loading} submitLabel="Catat kasbon" onCancel={onCancel} />
      </form>
    </Modal>
  );
}
