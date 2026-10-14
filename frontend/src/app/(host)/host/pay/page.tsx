"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Crown, Download, FileText, HandCoins, Send, Wallet } from "lucide-react";
import { errorMessage, payApi, type BrandPeriod } from "@/lib/api";
import { formatDate, formatDuration, formatPeriodDates, formatRupiah, formatShortDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import ConfirmDialog from "@/components/ConfirmDialog";
import FormAlert from "@/components/FormAlert";
import { CardsSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import PeriodBadge from "@/components/PeriodBadge";
import StatusBadge from "@/components/StatusBadge";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const advanceTypes = { early_payment: "Gaji di muka", loan: "Pinjaman" } as const;

/** Pay building up in open periods, my salary slips and my kasbon. */
export default function HostPayPage() {
  const { token } = useAuth();
  const pay = useApiData("my-pay", () => payApi.mine(token));
  const data = pay.data;

  const estimate = data?.current.reduce((total, period) => total + period.estimate, 0) ?? 0;
  const hours = data?.current.reduce((total, period) => total + period.hours, 0) ?? 0;
  const openKasbon = data?.advances.filter((advance) => advance.status !== "paid") ?? [];
  const owed = openKasbon.reduce((total, advance) => total + advance.remaining, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Gaji saya" description="Perkiraan memakai tarifmu saat ini. Jumlah akhir ditetapkan saat agensi mengajukan pembayaran." />

      {pay.error && <ErrorState message={pay.error} onRetry={pay.reload} />}
      {!data && !pay.error && <CardsSkeleton count={3} className="md:grid-cols-3" />}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={Wallet} tone="brand" label="Perkiraan periode ini" value={formatRupiah(estimate)} note={`${data.current.length} brand · ${formatDuration(hours)}`} />
            <StatCard
              icon={FileText}
              label="Slip terakhir"
              value={data.slips[0] ? formatRupiah(data.slips[0].net_amount) : "–"}
              note={data.slips[0] ? `${data.slips[0].brand.name} · ${formatShortDate(data.slips[0].period_end)}` : "Belum ada slip"}
            />
            <StatCard icon={HandCoins} label="Sisa kasbon" value={formatRupiah(owed)} note={owed > 0 ? `${openKasbon.length} kasbon berjalan` : "Tidak ada kasbon"} />
          </div>

          {data.brand_periods.length > 0 && <BrandPeriods periods={data.brand_periods} onChanged={pay.reload} />}

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-6">
              <Card title="Periode berjalan">
                {data.current.length === 0 ? (
                  <EmptyState compact icon={Wallet} title="Belum ada jam yang disetujui" description="Jam live masuk ke sini setelah laporanmu disetujui." />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.current.map((period) => (
                      <li key={period.period_id} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{period.brand.name}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {formatPeriodDates(period.period_start, period.period_end)} · {period.session_count} sesi
                          </p>
                          {period.carried_in_hours > 0 && (
                            <p className="text-xs text-muted-foreground">+{formatDuration(period.carried_in_hours)} bawaan dari periode lalu, dibayar duluan</p>
                          )}
                          {period.carried_out_hours > 0 && (
                            <p className="text-xs text-warning">{formatDuration(period.carried_out_hours)} melewati target brand, dibayar di periode berikutnya</p>
                          )}
                          {period.host_paid.map((cover) => (
                            <p key={cover.payer} className="text-xs text-muted-foreground">
                              Backup {formatDuration(cover.hours)} dibayar langsung oleh {cover.payer}, tidak lewat agensi
                            </p>
                          ))}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-base font-semibold whitespace-nowrap text-foreground tabular-nums">{formatRupiah(period.estimate)}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {formatDuration(period.hours)} × {formatRupiah(period.rate_per_hour)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Slip gaji" bodyClassName="px-0 pb-2 md:px-0">
                {data.slips.length === 0 ? (
                  <EmptyState compact icon={FileText} title="Belum ada slip" description="Slip muncul setelah periode dibayar." />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.slips.map((slip) => (
                      <li key={slip.id}>
                        <Link
                          href={`/host/pay/slips/${slip.id}`}
                          className="flex items-center gap-4 px-5 py-3.5 transition-colors outline-none hover:bg-muted/60 focus-visible:bg-muted/60 md:px-6"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <FileText className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{slip.brand.name}</span>
                            <span className="block text-xs text-muted-foreground tabular-nums">
                              {formatPeriodDates(slip.period_start, slip.period_end)}
                              {slip.advance_deduction > 0 && ` · kasbon −${formatRupiah(slip.advance_deduction)}`}
                            </span>
                          </span>
                          <span className="text-sm font-semibold text-foreground tabular-nums">{formatRupiah(slip.net_amount)}</span>
                          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <Card title="Kasbon" description="Dicicil dari slip gajimu berikutnya.">
              {data.advances.length === 0 ? (
                <EmptyState compact icon={HandCoins} title="Tidak ada kasbon" />
              ) : (
                <ul className="space-y-4">
                  {data.advances.map((advance) => {
                    const paid = advance.total_amount - advance.remaining;
                    const percent = advance.total_amount > 0 ? Math.round((paid / advance.total_amount) * 100) : 100;
                    return (
                      <li key={advance.id} className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{advanceTypes[advance.type]}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(advance.requested_at)} · {advance.installment_count} cicilan
                            </p>
                          </div>
                          {advance.status === "paid" ? (
                            <StatusBadge tone="success">Lunas</StatusBadge>
                          ) : (
                            <p className="text-right text-sm font-semibold text-foreground tabular-nums">{formatRupiah(advance.total_amount)}</p>
                          )}
                        </div>
                        {advance.status !== "paid" && (
                          <>
                            <Progress value={percent} aria-label={`Kasbon terbayar ${percent}%`} className="h-1.5" />
                            <p className="flex justify-between text-xs text-muted-foreground tabular-nums">
                              <span>Terbayar {formatRupiah(paid)}</span>
                              <span>Sisa {formatRupiah(advance.remaining)}</span>
                            </p>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * As the brand's leader (PIC): each period's progress to the target, and the request for
 * payment once it is reached. Finance follows it up and marks it paid.
 */
function BrandPeriods({ periods, onChanged }: { periods: BrandPeriod[]; onChanged: () => void }) {
  const { token } = useAuth();
  const [asking, setAsking] = useState<BrandPeriod | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(period: BrandPeriod) {
    const tab = window.open("", "_blank");
    try {
      const url = await payApi.exportUrl(token, period.id);
      if (tab) tab.location.href = url;
    } catch (caught) {
      tab?.close();
      setError(errorMessage(caught));
    }
  }

  return (
    <Card title="Pembayaran brand" description="Kamu PIC (leader) brand ini: ajukan pembayaran ke brand setiap kali target jam tercapai.">
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <ul className="divide-y divide-border">
        {periods.map((period) => {
          const percent = period.target_hours > 0 ? Math.min(100, (period.progress_hours / period.target_hours) * 100) : 0;
          const blocked = period.pending_reports + period.pending_letters > 0;

          return (
            <li key={period.id} className="space-y-2 py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    <Crown className="size-3.5 text-warning" aria-hidden="true" />
                    {period.brand.name}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">{formatPeriodDates(period.period_start, period.period_end)}</p>
                </div>
                <PeriodBadge status={period.status} />
              </div>

              {period.status === "in_progress" && (
                <>
                  <Progress value={percent} aria-label={`Jam ${period.brand.name}`} className="h-1.5" />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatDuration(period.progress_hours)} / {period.target_hours} jam · kurang {formatDuration(Math.max(0, period.target_hours - period.progress_hours))}
                  </p>
                </>
              )}

              {period.status === "waiting_payment" && (
                <>
                  <p className="text-sm text-body">
                    {period.closed_early ? "Periode ditutup lebih awal oleh agensi" : "Target tercapai"}: {formatDuration(period.achieved_hours)} bisa ditagihkan ke brand.
                  </p>
                  {blocked && (
                    <p className="text-xs text-warning">
                      {[
                        period.pending_reports > 0 && `${period.pending_reports} laporan live masih menunggu dicek operator`,
                        period.pending_letters > 0 && `${period.pending_letters} backup sakit masih menunggu surat dokter`,
                      ]
                        .filter(Boolean)
                        .join("; ")}
                      . Pembayaran bisa diajukan setelah itu.
                    </p>
                  )}
                  <Button type="button" size="sm" disabled={blocked} onClick={() => setAsking(period)}>
                    <Send aria-hidden="true" />
                    Ajukan pembayaran
                  </Button>
                </>
              )}

              {(period.status === "requested" || period.status === "paid") && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(period.achieved_hours)} ditagihkan
                    {period.request && ` · diajukan ${formatDate(period.request.requested_at)}${period.request.requester ? ` oleh ${period.request.requester}` : ""}`}
                    {period.request?.paid_at && ` · lunas ${formatDate(period.request.paid_at)}`}
                  </p>
                  <Button type="button" variant="outline" size="xs" onClick={() => download(period)}>
                    <Download aria-hidden="true" />
                    Laporan brand
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {asking && (
        <ConfirmDialog
          title={`Ajukan pembayaran ${asking.brand.name}?`}
          confirmLabel="Ajukan"
          destructive={false}
          onConfirm={async () => {
            setError(null);
            try {
              notify({ text: (await payApi.requestPayment(token, asking.id)).message });
            } catch (caught) {
              setError(errorMessage(caught));
            }
            onChanged();
          }}
          onClose={() => setAsking(null)}
        >
          {formatDuration(asking.achieved_hours)} untuk {formatPeriodDates(asking.period_start, asking.period_end)}. Jam dan gaji host dikunci, lalu unduh laporannya dan kirim ke brand.
          Finance menandai lunas setelah brand membayar.
        </ConfirmDialog>
      )}
    </Card>
  );
}
