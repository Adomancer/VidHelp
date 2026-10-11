"use client";

import { FileWarning, ShieldCheck, Star, ThumbsUp } from "lucide-react";
import { performanceApi } from "@/lib/api";
import { formatDate, formatShortDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { CardsSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import PointsMeter, { SpBadge } from "@/components/PointsMeter";

function monthLabel(monthYear: string): string {
  return new Date(`${monthYear}-01T00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

/** My points this period, my warning letters and my monthly ratings. */
export default function HostScorePage() {
  const { token } = useAuth();
  const performance = useApiData("performance", () => performanceApi.mine(token));
  const data = performance.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Skor saya" description="Poin disiplin, surat peringatan dan rating bulanan dari agensi." />
      {performance.error && <ErrorState message={performance.error} onRetry={performance.reload} />}
      {!data && !performance.error && <CardsSkeleton count={2} className="lg:grid-cols-2" />}

      {data && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card
              title="Poin periode ini"
              description={`${formatDate(data.period.start)} – ${formatDate(data.period.end)}. Kembali ke ${data.opening_points} saat periode berikutnya dimulai.`}
            >
              <PointsMeter points={data.points} opening={data.opening_points} thresholds={data.thresholds} />
            </Card>

            <Card title="Potongan periode ini">
              {data.logs.length === 0 ? (
                <EmptyState compact icon={ThumbsUp} title="Tidak ada potongan" description="Pertahankan!" />
              ) : (
                <ul className="divide-y divide-border">
                  {data.logs.map((log) => (
                    <li key={log.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{log.violation_type?.name ?? "Penyesuaian"}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatShortDate(log.occurred_on)}
                          {log.reason ? ` · ${log.reason}` : ""}
                        </p>
                      </div>
                      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", log.points_change < 0 ? "text-destructive" : "text-success")}>
                        {log.points_change > 0 ? "+" : ""}
                        {log.points_change}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card title="Surat peringatan">
              {data.warning_letters.length === 0 ? (
                <EmptyState compact icon={ShieldCheck} title="Tidak ada surat peringatan" />
              ) : (
                <ul className="divide-y divide-border">
                  {data.warning_letters.map((letter) => (
                    <li key={letter.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <FileWarning className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">{letter.reason}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(letter.issued_at)}</p>
                      </div>
                      <SpBadge level={letter.level} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Rating bulanan">
              {data.ratings.length === 0 ? (
                <EmptyState compact icon={Star} title="Belum pernah dinilai" />
              ) : (
                <ul className="divide-y divide-border">
                  {data.ratings.map((rating) => (
                    <li key={rating.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{monthLabel(rating.month_year)}</p>
                        {rating.note && <p className="text-xs text-muted-foreground">{rating.note}</p>}
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-base font-semibold text-foreground tabular-nums">
                        <Star className="size-4 fill-warning text-warning" aria-hidden="true" />
                        {rating.rating.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
