"use client";

import { useState } from "react";
import { ChevronDown, Download, Star, Users } from "lucide-react";
import { errorMessage, pointsApi, type RatingRow } from "@/lib/api";
import { formatDate, formatShortDate } from "@/lib/format";
import { inputClass, inputSmClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import FormAlert from "@/components/FormAlert";
import { ListSkeleton, RefreshBar } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import { SpBadge } from "@/components/PointsMeter";
import { sourceLabels } from "@/components/PointsDesk";
import StatusBadge from "@/components/StatusBadge";
import { notify } from "@/components/Toast";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function AdminRatingsPage() {
  const { token } = useAuth();
  const [month, setMonth] = useState(thisMonth());
  const [error, setError] = useState<string | null>(null);
  const ratings = useApiData(`ratings-${month}`, () => pointsApi.ratings(token, month));
  const [exporting, setExporting] = useState(false);
  const rows = ratings.data?.hosts;
  const rated = rows?.filter((row) => row.rating).length ?? 0;

  async function exportExcel() {
    setExporting(true);
    try {
      await pointsApi.exportRatings(token, month);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Rating"
        description="Beri rating 1–5 untuk setiap host per bulan. Saran rating adalah 5 dikurangi dampak pelanggaran bulan itu. Rating terbaru juga menentukan siapa yang otomatis dipilih untuk backup."
        actions={
          <>
            <input
              type="month"
              value={month}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
              aria-label="Bulan"
              className={cn(inputClass, "w-auto tabular-nums")}
            />
            <Button type="button" variant="outline" onClick={exportExcel} disabled={exporting} title="Rating, riwayat poin, dan riwayat SP bulan ini">
              <Download aria-hidden="true" />
              {exporting ? "Mengekspor…" : "Ekspor Excel"}
            </Button>
          </>
        }
      />

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {ratings.error && <ErrorState message={ratings.error} onRetry={ratings.reload} />}

      {rows && rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{rated}</span> dari {rows.length} host sudah dinilai bulan ini.
        </p>
      )}

      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <RefreshBar active={ratings.loading && Boolean(rows)} />
        {!rows && !ratings.error && <ListSkeleton rows={5} className="p-4" />}
        {rows?.length === 0 && <EmptyState icon={Users} title="Tidak ada host aktif" />}
        <ul className="divide-y divide-border">
          {rows?.map((row) => (
            <RatingLine
              key={`${month}-${row.host_id}-${row.rating?.rating ?? "none"}`}
              row={row}
              month={month}
              onSaved={(text) => {
                notify({ text });
                ratings.reload();
              }}
              onError={setError}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function RatingLine({ row, month, onSaved, onError }: { row: RatingRow; month: string; onSaved: (text: string) => void; onError: (text: string) => void }) {
  const { token } = useAuth();
  const [rating, setRating] = useState(String(row.rating?.rating ?? row.suggested));
  const [note, setNote] = useState(row.rating?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await pointsApi.rate(token, { host_id: row.host_id, month_year: month, rating: Number(rating), note: note || null });
      onSaved(`Tersimpan ${row.name}: ${Number(rating).toFixed(1)}`);
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-48 flex-1 items-center gap-3">
          <UserAvatar user={row} size="size-9 text-sm" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <span className="truncate">{row.name}</span>
              {row.rating ? (
                <StatusBadge tone="success" className="h-5 px-1.5 text-[11px]">
                  Dinilai
                </StatusBadge>
              ) : (
                <StatusBadge tone="neutral" className="h-5 px-1.5 text-[11px]">
                  Belum
                </StatusBadge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.violations} pelanggaran · saran {row.suggested.toFixed(1)}
              {row.rating?.rater && ` · oleh ${row.rating.rater.name}`}
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative w-24">
            <Star className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 fill-warning text-warning" aria-hidden="true" />
            <input
              type="number"
              min={1}
              max={5}
              step={0.1}
              value={rating}
              onChange={(event) => setRating(event.target.value)}
              aria-label={`Rating untuk ${row.name}`}
              className={cn(inputSmClass, "pl-8 tabular-nums")}
            />
          </div>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Catatan"
            maxLength={255}
            aria-label={`Catatan untuk ${row.name}`}
            className={cn(inputSmClass, "min-w-32 flex-1 sm:w-48 sm:flex-none")}
          />
          <Button type="button" size="sm" onClick={save} disabled={saving || rating === ""}>
            {saving ? "Menyimpan…" : row.rating ? "Perbarui" : "Simpan"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
            Riwayat
            <ChevronDown className={cn("transition-transform", showHistory && "rotate-180")} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {showHistory && <HostHistory hostId={row.host_id} />}
    </li>
  );
}

/** A host's point and SP history across every period, newest first. Cancelled entries are struck through. */
function HostHistory({ hostId }: { hostId: string }) {
  const { token } = useAuth();
  const history = useApiData(`rating-history-${hostId}`, () => pointsApi.history(token, hostId));

  if (history.error) return <FormAlert tone="error">{history.error}</FormAlert>;
  if (!history.data) return <ListSkeleton rows={2} />;
  const { logs, warning_letters: letters } = history.data;

  return (
    <div className="grid gap-4 rounded-lg border border-border bg-muted/40 p-3 md:grid-cols-2">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Riwayat poin</h3>
        {logs.length === 0 && <p className="text-sm text-muted-foreground">Belum ada perubahan poin.</p>}
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {logs.map((log) => (
            <li key={log.id} className="rounded-md border border-border bg-card px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className={cn("text-sm", log.voided_at ? "text-faint line-through" : "text-foreground")}>
                  {log.violation_type?.name ?? sourceLabels[log.source]}
                  {log.brand_complaint && <span className="text-muted-foreground"> · {log.brand_complaint.brand.name}</span>}
                </span>
                <span className={cn("text-sm font-semibold tabular-nums", log.voided_at ? "text-faint" : log.points_change < 0 ? "text-destructive" : "text-success")}>
                  {log.points_change > 0 ? "+" : ""}
                  {log.points_change}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatShortDate(log.occurred_on)}
                {log.recorder ? ` · oleh ${log.recorder.name}` : " · otomatis"}
                {log.voided_at ? " · dibatalkan" : ""}
                {log.reason ? ` · ${log.reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Riwayat SP</h3>
        {letters.length === 0 && <p className="text-sm text-muted-foreground">Belum ada surat peringatan.</p>}
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {letters.map((letter) => (
            <li key={letter.id} className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2">
              {letter.voided_at ? <span className="text-xs text-faint line-through">SP{letter.level}</span> : <SpBadge level={letter.level} />}
              <div className="min-w-0">
                <p className={cn("text-sm", letter.voided_at ? "text-faint line-through" : "text-foreground")}>{letter.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(letter.issued_at)} · {letter.issuer ? `oleh ${letter.issuer.name}` : "otomatis"}
                  {letter.voided_at ? " · dibatalkan" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
