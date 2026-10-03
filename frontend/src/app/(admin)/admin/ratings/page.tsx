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
          <h1 className="text-2xl font-bold text-white">Ratings</h1>
          <p className="text-sm text-gray-400 mt-1">
            Rate each host 1–5 for the month. The suggestion is 5 minus the rating impact of that month&apos;s violations. The latest
            rating also decides who is auto-picked for backups.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            type="month"
            value={month}
            onChange={(event) => event.target.value && setMonth(event.target.value)}
            aria-label="Month"
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white"
          />
          <button
            type="button"
            onClick={exportExcel}
            disabled={exporting}
            title="Ratings, point history and SP history of this month"
            className="px-4 py-2 rounded-lg border border-slate-700 text-gray-200 text-sm whitespace-nowrap hover:bg-slate-800 disabled:opacity-40"
          >
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
        </div>
      </div>

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {ratings.error && <FormAlert tone="error">{ratings.error}</FormAlert>}

      <div className={`bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800 ${ratings.loading ? "opacity-60" : ""}`}>
        {ratings.data?.hosts.length === 0 && <p className="px-4 py-8 text-center text-gray-400">No active hosts.</p>}
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
      onSaved(`Saved ${row.name}: ${Number(rating).toFixed(1)}`);
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
          <p className="text-white">{row.name}</p>
          <p className="text-xs text-gray-400">
            {row.violations} violation{row.violations === 1 ? "" : "s"} · suggested {row.suggested.toFixed(1)}
            {row.rating ? ` · rated ${row.rating.rating.toFixed(1)}${row.rating.rater ? ` by ${row.rating.rater.name}` : ""}` : " · not rated yet"}
          </p>
        </div>
        <input
          type="number"
          min={1}
          max={5}
          step={0.1}
          value={rating}
          onChange={(event) => setRating(event.target.value)}
          aria-label={`Rating for ${row.name}`}
          className="w-20 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-white"
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note"
          maxLength={255}
          aria-label={`Note for ${row.name}`}
          className="w-48 px-2 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-white text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || rating === ""}
          className="px-3 py-1.5 rounded-md bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-40"
        >
          {row.rating ? "Update" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          aria-expanded={showHistory}
          className="px-3 py-1.5 rounded-md border border-slate-700 text-gray-300 text-sm hover:bg-slate-800"
        >
          {showHistory ? "Hide history" : "History"}
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
  if (!history.data) return <p className="text-sm text-gray-400">Loading…</p>;
  const { logs, warning_letters: letters } = history.data;

  return (
    <div className="grid gap-4 md:grid-cols-2 rounded-lg bg-slate-950/60 p-3">
      <section>
        <h3 className="text-sm font-medium text-white mb-2">Point history</h3>
        {logs.length === 0 && <p className="text-sm text-gray-400">No point changes.</p>}
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {logs.map((log) => (
            <li key={log.id} className="rounded-md bg-slate-800/70 px-3 py-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className={`text-sm ${log.voided_at ? "text-gray-500 line-through" : "text-white"}`}>
                  {log.violation_type?.name ?? sourceLabels[log.source]}
                  {log.brand_complaint && <span className="text-gray-400"> · {log.brand_complaint.brand.name}</span>}
                </span>
                <span className={`text-sm font-medium ${log.voided_at ? "text-gray-500" : log.points_change < 0 ? "text-red-300" : "text-green-300"}`}>
                  {log.points_change > 0 ? "+" : ""}
                  {log.points_change}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {formatShortDate(log.occurred_on)}
                {log.recorder ? ` · by ${log.recorder.name}` : " · automatic"}
                {log.voided_at ? " · cancelled" : ""}
                {log.reason ? ` · ${log.reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-medium text-white mb-2">SP history</h3>
        {letters.length === 0 && <p className="text-sm text-gray-400">No warning letters.</p>}
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {letters.map((letter) => (
            <li key={letter.id} className="flex items-start gap-3 rounded-md bg-slate-800/70 px-3 py-1.5">
              {letter.voided_at ? <span className="text-xs text-gray-500 line-through">SP{letter.level}</span> : <SpBadge level={letter.level} />}
              <div className="min-w-0">
                <p className={`text-sm ${letter.voided_at ? "text-gray-500 line-through" : "text-white"}`}>{letter.reason}</p>
                <p className="text-xs text-gray-400">
                  {formatDate(letter.issued_at)} · {letter.issuer ? `by ${letter.issuer.name}` : "automatic"}
                  {letter.voided_at ? " · cancelled" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
