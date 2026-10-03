"use client";

import type { SlipDetail } from "@/lib/api";
import { formatDate, formatDuration, formatRupiah } from "@/lib/format";

const advanceLabels = { early_payment: "Gaji di muka", loan: "Pinjaman" } as const;

/**
 * A salary slip laid out for printing ("Save as PDF" in the print dialog).
 */
export default function SlipView({ slip }: { slip: SlipDetail }) {
  return (
    <div className="max-w-xl space-y-4">
      <div className="flex justify-end print:hidden">
        <button type="button" onClick={() => window.print()} className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500">
          Cetak / simpan sebagai PDF
        </button>
      </div>

      <article className="bg-white text-slate-900 rounded-xl p-6 space-y-5">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xl font-bold">VidHelp</p>
            <p className="text-sm text-slate-500">Slip gaji</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{slip.brand.name}</p>
            <p className="text-slate-500">
              {formatDate(slip.period_start)} – {formatDate(slip.period_end)}
            </p>
          </div>
        </header>

        <section className="text-sm">
          <p className="font-medium text-base">{slip.host_name}</p>
          {slip.bank && (
            <p className="text-slate-500">
              {slip.bank.bank_name ?? "Bank"} {slip.bank.account ?? ""}
              {slip.bank.holder ? ` · ${slip.bank.holder}` : ""}
            </p>
          )}
        </section>

        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-200">
            <tr>
              <td className="py-2 text-slate-600">Sesi live</td>
              <td className="py-2 text-right">{slip.session_count}</td>
            </tr>
            <tr>
              <td className="py-2 text-slate-600">Durasi live</td>
              <td className="py-2 text-right">{formatDuration(slip.hours)}</td>
            </tr>
            <tr>
              <td className="py-2 text-slate-600">Tarif per jam</td>
              <td className="py-2 text-right">{formatRupiah(slip.rate_per_hour)}</td>
            </tr>
            <tr className="font-medium">
              <td className="py-2">Gaji kotor</td>
              <td className="py-2 text-right">{formatRupiah(slip.gross_amount)}</td>
            </tr>
            {slip.deductions.map((deduction) => (
              <tr key={`${deduction.type}-${deduction.seq}`}>
                <td className="py-2 text-slate-600">
                  Kasbon ({advanceLabels[deduction.type]}) cicilan {deduction.seq}/{deduction.installment_count}
                </td>
                <td className="py-2 text-right text-red-700">− {formatRupiah(deduction.amount)}</td>
              </tr>
            ))}
            <tr className="text-base font-bold">
              <td className="py-3">Gaji bersih</td>
              <td className="py-3 text-right">{formatRupiah(slip.net_amount)}</td>
            </tr>
          </tbody>
        </table>

        {slip.skipped_deductions.length > 0 && (
          <section className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
            <p className="font-medium">Tidak dipotong kali ini (gaji tidak cukup), dipindah ke slip berikutnya:</p>
            {slip.skipped_deductions.map((deduction) => (
              <p key={`${deduction.type}-${deduction.seq}`}>
                Kasbon ({advanceLabels[deduction.type]}) cicilan {deduction.seq}/{deduction.installment_count}: {formatRupiah(deduction.amount)}
              </p>
            ))}
          </section>
        )}

        <footer className="text-xs text-slate-400">Dibuat {formatDate(slip.generated_at)}</footer>
      </article>
    </div>
  );
}
