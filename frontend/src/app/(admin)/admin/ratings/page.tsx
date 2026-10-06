"use client";

import { useState } from "react";
import { errorMessage, pointsApi, type RatingRow } from "@/lib/api";
import { formatDate, formatShortDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import FormAlert from "@/components/FormAlert";
import { SpBadge } from "@/components/PointsMeter";
import { sourceLabels } from "@/components/PointsDesk";
import UserAvatar from "@/components/UserAvatar";

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function AdminRatingsPage() {
  const { token } = useAuth();
  const [month, setMonth] = useState(thisMonth());
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const ratings = useApiData(`ratings-${month}`, () => pointsApi.ratings(token, month));
  const [exporting, setExporting] = useState(false);

  async function exportExcel() {
    setExporting(true);
    try {
      await pointsApi.exportRatings(token, month);
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-heading">Rating</h1>
          <p className="text-sm text-muted mt-1">
            Beri rating 1–5 untuk setiap host per bulan. Saran rating adalah 5 dikurangi dampak rating dari pelanggaran bulan itu. Rating
            terbaru juga menentukan siapa yang otomatis dipilih untuk backup.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="month"
            value={month}
            onChange={(event) => event.target.value && setMonth(event.target.value)}
            aria-label="Bulan"
            className="px-3 py-2 rounded-lg bg-surface border border-stroke text-heading"
          />
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting}
            title="Rating, riwayat poin, dan riwayat SP bulan ini"
            className="px-4 py-2 rounded-lg border border-stroke-strong text-body text-sm whitespace-nowrap hover:bg-surface-2 disabled:opacity-40"
          >
            {exporting ? "Mengekspor…" : "Ekspor Excel"}
          </button>
        </div>
      </div>

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {ratings.error && <FormAlert tone="error">{ratings.error}</FormAlert>}

      <div className={`bg-surface border border-stroke rounded-[10px] shadow-card divide-y divide-stroke ${ratings.loading ? "opacity-60" : ""}`}>
        {ratings.data?.hosts.length === 0 && <p className="px-4 py-8 text-center text-muted">Tidak ada host aktif.</p>}
        {ratings.data?.hosts.map((row) => (
          <RatingLine
            key={`${month}-${row.host_id}-${row.rating?.rating ?? "none"}`}
            row={row}
            month={month}
            onSaved={(text, tone = "success") => {
              setNotice({ tone, text });
              if (tone === "success") ratings.reload();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function RatingLine({ row, month, onSaved }: { row: RatingRow; month: string; onSaved: (text: string, tone?: "success" | "error") => void }) {
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
      onSaved(errorMessage(caught), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <UserAvatar user={row} size="w-8 h-8" />
        <div className="flex-1 min-w-40">
          <p className="text-heading">{row.name}</p>
          <p className="text-xs text-muted">
            {row.violations} pelanggaran · saran {row.suggested.toFixed(1)}
            {row.rating ? ` · dinilai ${row.rating.rating.toFixed(1)}${row.rating.rater ? ` oleh ${row.rating.rater.name}` : ""}` : " · belum dinilai"}
          </p>
        </div>
        <input
          type="number"
          min={1}
          max={5}
          step={0.1}
          value={rating}
          onChange={(event) => setRating(event.target.value)}
          aria-label={`Rating untuk ${row.name}`}
          className="w-20 px-2 py-1.5 rounded-md bg-surface-2 border border-stroke-strong text-heading"
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Catatan"
          maxLength={255}
          aria-label={`Catatan untuk ${row.name}`}
          className="w-48 px-2 py-1.5 rounded-md bg-surface-2 border border-stroke-strong text-heading text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || rating === ""}
          className="px-3 py-1.5 rounded-md bg-primary text-white text-sm hover:bg-primary-hover disabled:opacity-40"
        >
          {row.rating ? "Perbarui" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          aria-expanded={showHistory}
          className="px-3 py-1.5 rounded-md border border-stroke-strong text-body text-sm hover:bg-surface-2"
        >
          {showHistory ? "Tutup riwayat" : "Riwayat"}
        </button>
      </div>
      {showHistory && <HostHistory hostId={row.host_id} />}
    </div>
  );
}

/** A host's point and SP history across every period, newest first. Cancelled entries are struck through. */
function HostHistory({ hostId }: { hostId: string }) {
  const { token } = useAuth();
  const history = useApiData(`rating-history-${hostId}`, () => pointsApi.history(token, hostId));

  if (history.error) return <FormAlert tone="error">{history.error}</FormAlert>;
  if (!history.data) return <p className="text-sm text-muted">Memuat…</p>;
  const { logs, warning_letters: letters } = history.data;

  return (
    <div className="grid gap-4 md:grid-cols-2 rounded-lg bg-surface-2 p-3">
      <section>
        <h3 className="text-sm font-medium text-heading mb-2">Riwayat poin</h3>
        {logs.length === 0 && <p className="text-sm text-muted">Belum ada perubahan poin.</p>}
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {logs.map((log) => (
            <li key={log.id} className="rounded-md bg-surface-2 px-3 py-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className={`text-sm ${log.voided_at ? "text-faint line-through" : "text-heading"}`}>
                  {log.violation_type?.name ?? sourceLabels[log.source]}
                  {log.brand_complaint && <span className="text-muted"> · {log.brand_complaint.brand.name}</span>}
                </span>
                <span className={`text-sm font-medium ${log.voided_at ? "text-faint" : log.points_change < 0 ? "text-danger" : "text-success"}`}>
                  {log.points_change > 0 ? "+" : ""}
                  {log.points_change}
                </span>
              </div>
              <p className="text-xs text-muted">
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
        <h3 className="text-sm font-medium text-heading mb-2">Riwayat SP</h3>
        {letters.length === 0 && <p className="text-sm text-muted">Belum ada surat peringatan.</p>}
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {letters.map((letter) => (
            <li key={letter.id} className="flex items-start gap-3 rounded-md bg-surface-2 px-3 py-1.5">
              {letter.voided_at ? <span className="text-xs text-faint line-through">SP{letter.level}</span> : <SpBadge level={letter.level} />}
              <div className="min-w-0">
                <p className={`text-sm ${letter.voided_at ? "text-faint line-through" : "text-heading"}`}>{letter.reason}</p>
                <p className="text-xs text-muted">
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
