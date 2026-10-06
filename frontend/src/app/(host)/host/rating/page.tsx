"use client";

import { performanceApi } from "@/lib/api";
import { formatDate, formatShortDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";
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
    <div className="max-w-lg space-y-5">
      <h1 className="text-xl font-bold text-heading">Skor Saya</h1>
      {performance.error && <FormAlert tone="error">{performance.error}</FormAlert>}

      {data && (
        <>
          <Card>
            <p className="text-xs text-muted">
              Poin {formatDate(data.period.start)} – {formatDate(data.period.end)}. Kembali ke {data.opening_points} saat periode berikutnya
              dimulai.
            </p>
            <PointsMeter points={data.points} opening={data.opening_points} thresholds={data.thresholds} />
          </Card>

          <Card title="Potongan periode ini">
            {data.logs.length === 0 && <p className="text-sm text-muted">Tidak ada, pertahankan!</p>}
            <ul className="space-y-2">
              {data.logs.map((log) => (
                <li key={log.id} className="rounded-lg bg-surface-2 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-heading">{log.violation_type?.name ?? "Penyesuaian"}</span>
                    <span className={`text-sm font-medium ${log.points_change < 0 ? "text-danger" : "text-success"}`}>
                      {log.points_change > 0 ? "+" : ""}
                      {log.points_change}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {formatShortDate(log.occurred_on)}
                    {log.reason ? ` · ${log.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          {data.warning_letters.length > 0 && (
            <Card title="Surat peringatan">
              <ul className="space-y-2">
                {data.warning_letters.map((letter) => (
                  <li key={letter.id} className="flex items-start gap-3">
                    <SpBadge level={letter.level} />
                    <div>
                      <p className="text-sm text-heading">{letter.reason}</p>
                      <p className="text-xs text-muted">{formatDate(letter.issued_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Rating bulanan">
            {data.ratings.length === 0 && <p className="text-sm text-muted">Kamu belum pernah dinilai.</p>}
            <ul className="space-y-2">
              {data.ratings.map((rating) => (
                <li key={rating.id} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-heading">{monthLabel(rating.month_year)}</p>
                    {rating.note && <p className="text-xs text-muted">{rating.note}</p>}
                  </div>
                  <span className="text-lg font-semibold text-warning">★ {rating.rating.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
