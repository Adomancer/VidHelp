"use client";

import Link from "next/link";
import { payApi } from "@/lib/api";
import { formatDate, formatDuration, formatRupiah } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";

const advanceTypes = { early_payment: "Gaji di muka", loan: "Pinjaman" } as const;

/** Pay building up in open periods, my salary slips and my kasbon. */
export default function HostPayPage() {
  const { token } = useAuth();
  const pay = useApiData("my-pay", () => payApi.mine(token));
  const data = pay.data;

  return (
    <div className="max-w-lg space-y-5">
      <h1 className="text-xl font-bold text-heading">Gaji Saya</h1>
      {pay.error && <FormAlert tone="error">{pay.error}</FormAlert>}

      {data && (
        <>
          <Card title="Periode ini" description="Perkiraan dengan tarifmu saat ini; jumlah akhir ditetapkan saat agensi mengajukan pembayaran.">
            {data.current.length === 0 && <p className="text-sm text-muted">Belum ada jam yang disetujui di periode yang berjalan.</p>}
            <ul className="space-y-2">
              {data.current.map((period) => (
                <li key={period.period_id} className="rounded-lg bg-surface-2 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-heading">{period.brand.name}</span>
                    <span className="text-lg font-semibold text-success">{formatRupiah(period.estimate)}</span>
                  </div>
                  <p className="text-xs text-muted">
                    {formatDate(period.period_start)} – {formatDate(period.period_end)} · {period.session_count} sesi
                    · {formatDuration(period.hours)} × {formatRupiah(period.rate_per_hour)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Slip gaji">
            {data.slips.length === 0 && <p className="text-sm text-muted">Belum ada slip.</p>}
            <ul className="space-y-2">
              {data.slips.map((slip) => (
                <li key={slip.id}>
                  <Link href={`/host/pay/slips/${slip.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 hover:bg-surface-3">
                    <span>
                      <span className="block text-heading">{slip.brand.name}</span>
                      <span className="block text-xs text-muted">
                        {formatDate(slip.period_start)} – {formatDate(slip.period_end)}
                        {slip.advance_deduction > 0 && ` · kasbon −${formatRupiah(slip.advance_deduction)}`}
                      </span>
                    </span>
                    <span className="font-semibold text-heading">{formatRupiah(slip.net_amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {data.advances.length > 0 && (
            <Card title="Kasbon">
              <ul className="space-y-2">
                {data.advances.map((advance) => (
                  <li key={advance.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="block text-heading">
                        {advanceTypes[advance.type]} · {formatRupiah(advance.total_amount)}
                      </span>
                      <span className="block text-xs text-muted">
                        {formatDate(advance.requested_at)} · {advance.installment_count} cicilan
                      </span>
                    </span>
                    <span className={advance.status === "paid" ? "text-success" : "text-warning"}>
                      {advance.status === "paid" ? "Lunas" : `sisa ${formatRupiah(advance.remaining)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
