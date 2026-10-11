"use client";

import { Info } from "lucide-react";
import type { SlipDetail } from "@/lib/api";
import { formatDate, formatDuration, formatRupiah } from "@/lib/format";

const advanceLabels = { early_payment: "Gaji di muka", loan: "Pinjaman" } as const;

/**
 * A salary slip as a sheet of paper: always white so it prints the same in either theme
 * ("Save as PDF" in the print dialog).
 */
export default function SlipView({ slip }: { slip: SlipDetail }) {
  return (
    <article className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 px-6 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-[#5750f1] text-base font-bold text-white print:border print:border-[#5750f1]">V</span>
          <div>
            <p className="text-lg font-semibold tracking-tight">VidHelp</p>
            <p className="text-sm text-zinc-500">Slip gaji</p>
          </div>
        </div>
        <div className="text-sm sm:text-right">
          <p className="font-medium">{slip.brand.name}</p>
          <p className="text-zinc-500 tabular-nums">
            {formatDate(slip.period_start)} – {formatDate(slip.period_end)}
          </p>
        </div>
      </header>

      <div className="space-y-6 px-6 py-6 sm:px-8">
        <section className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Host</p>
            <p className="mt-1 text-base font-medium">{slip.host_name}</p>
          </div>
          {slip.bank && (
            <div>
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Rekening</p>
              <p className="mt-1">
                {slip.bank.bank_name ?? "Bank"} <span className="tabular-nums">{slip.bank.account ?? ""}</span>
              </p>
              {slip.bank.holder && <p className="text-zinc-500">a.n. {slip.bank.holder}</p>}
            </div>
          )}
        </section>

        <table className="w-full text-sm">
          <tbody className="divide-y divide-zinc-200">
            <Row label="Sesi live" value={String(slip.session_count)} />
            {slip.carried_in_hours > 0 || slip.carried_out_hours > 0 ? (
              <>
                {slip.carried_in_hours > 0 && <Row label="Jam bawaan periode lalu" value={`+ ${formatDuration(slip.carried_in_hours)}`} />}
                <Row label="Durasi live periode ini" value={formatDuration(slip.worked_hours)} />
                {slip.carried_out_hours > 0 && (
                  <Row label="Melewati target brand, dibayar di periode berikutnya" value={`− ${formatDuration(slip.carried_out_hours)}`} />
                )}
                <Row label="Jam dibayar" value={formatDuration(slip.hours)} strong />
              </>
            ) : (
              <Row label="Durasi live" value={formatDuration(slip.hours)} />
            )}
            <Row label="Tarif per jam" value={formatRupiah(slip.rate_per_hour)} />
            <Row label="Gaji kotor" value={formatRupiah(slip.gross_amount)} strong />
            {slip.deductions.map((deduction) => (
              <Row
                key={`${deduction.type}-${deduction.seq}`}
                label={`Kasbon (${advanceLabels[deduction.type]}) cicilan ${deduction.seq}/${deduction.installment_count}`}
                value={`− ${formatRupiah(deduction.amount)}`}
              />
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between gap-4 rounded-lg bg-zinc-100 px-4 py-3.5 print:border print:border-zinc-300 print:bg-white">
          <span className="text-sm font-medium">Gaji bersih</span>
          <span className="text-xl font-semibold tracking-tight tabular-nums">{formatRupiah(slip.net_amount)}</span>
        </div>

        {slip.skipped_deductions.length > 0 && (
          <section className="flex gap-2.5 rounded-lg border border-zinc-200 px-4 py-3 text-xs text-zinc-700">
            <Info className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium text-zinc-900">Tidak dipotong kali ini (gaji tidak cukup), dipindah ke slip berikutnya:</p>
              {slip.skipped_deductions.map((deduction) => (
                <p key={`${deduction.type}-${deduction.seq}`}>
                  Kasbon ({advanceLabels[deduction.type]}) cicilan {deduction.seq}/{deduction.installment_count}: {formatRupiah(deduction.amount)}
                </p>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 sm:px-8">Dibuat {formatDate(slip.generated_at)}</footer>
    </article>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? "font-medium" : undefined}>
      <td className={strong ? "py-2.5" : "py-2.5 text-zinc-600"}>{label}</td>
      <td className="py-2.5 text-right tabular-nums">{value}</td>
    </tr>
  );
}
