"use client";

import { useState } from "react";
import { ChevronDown, Clock, ExternalLink, Star, UserRoundPlus } from "lucide-react";
import { errorMessage, operatorBackupApi, showInTab, type BackupCandidate, type BackupRequest } from "@/lib/api";
import { formatClock, formatDateTime, formatDuration, formatWindow } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "../AuthProvider";
import { BackupStatusBadge, LetterBadge, reasonLabels, RequestTypeBadge } from "../BackupBadges";
import FormAlert from "../FormAlert";
import { ListSkeleton } from "../Loading";
import UserAvatar from "../UserAvatar";
import { DateTile } from "./BackupRow";
import { type Act, type Confirm, hoursOf } from "./shared";

/** Everything about one request, with its actions; shown in the side panel. */
export function RequestDetail({ backup, act, onConfirm }: { backup: BackupRequest; act: Act; onConfirm: (confirm: Confirm) => void }) {
  const { token } = useAuth();
  const [choosing, setChoosing] = useState(backup.status === "pending" && new Date(backup.end_at) > new Date());
  const [letterError, setLetterError] = useState<string | null>(null);
  const running = new Date(backup.end_at) > new Date();
  const waiting = backup.status === "open" || backup.status === "pending";
  const nomineeNames = backup.nominees?.map((nominee) => nominee.host.user.name) ?? [];
  const hours = hoursOf(backup);

  async function openLetter() {
    // Open the tab during the click (popup blockers), then point it at the downloaded file
    const tab = window.open("", "_blank");
    try {
      const url = await operatorBackupApi.letterUrl(token, backup.id);
      if (tab) showInTab(tab, url);
      else URL.revokeObjectURL(url);
    } catch (caught) {
      tab?.close();
      setLetterError(errorMessage(caught));
    }
  }

  return (
    <div className="@container overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex gap-4 p-4">
        <DateTile iso={backup.start_at} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              {backup.requester && <UserAvatar user={backup.requester.user} size="size-8 text-xs" />}
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{backup.requester?.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{backup.brand.name}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <RequestTypeBadge names={nomineeNames} />
              <BackupStatusBadge status={backup.status} />
            </div>
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-sm @lg:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Sesi</dt>
              <dd className="flex items-center gap-1.5 font-medium whitespace-nowrap text-foreground tabular-nums">
                <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {formatClock(backup.start_at)}–{formatClock(backup.end_at)}
                <span className="font-normal text-muted-foreground">· {formatDuration(hours)}</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Alasan</dt>
              <dd className="truncate text-foreground" title={backup.reason ?? undefined}>
                {reasonLabels[backup.reason_type]}
                {backup.reason && <span className="text-muted-foreground"> · {backup.reason}</span>}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{backup.status === "filled" ? "Pengganti" : "Pendaftar"}</dt>
              <dd className="truncate text-foreground">
                {backup.status === "filled" && backup.filler ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-success">
                    <UserAvatar user={backup.filler.user} size="size-5 text-[9px]" />
                    {backup.filler.user.name}
                  </span>
                ) : waiting ? (
                  <>
                    <span className="font-medium tabular-nums">{backup.applicants_count ?? 0}</span> host
                  </>
                ) : (
                  <span className="text-muted-foreground">–</span>
                )}
              </dd>
            </div>
          </dl>

          {(backup.letter_status !== "not_needed" || (waiting && running) || backup.status === "filled") && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {backup.letter_status !== "not_needed" && (
                <span className="flex items-center gap-2">
                  <LetterBadge status={backup.letter_status} />
                  {backup.letter_status === "uploaded" && (
                    <button type="button" onClick={openLetter} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                      Lihat
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </button>
                  )}
                </span>
              )}
              {waiting && running && <span>Pendaftar terbaik disetujui otomatis {formatDateTime(backup.auto_fill_at)}</span>}
              {backup.status === "filled" && (
                <span>
                  {backup.auto_filled ? "Disetujui otomatis" : "Disetujui admin"}
                  {backup.counts_toward_quota && " · brand lain, memakai kuota"}
                  {" · "}
                  {backup.cover_paid_by === "agency"
                    ? "dibayar agensi"
                    : backup.cover_paid_by === "requester"
                      ? `dibayar langsung oleh ${backup.requester?.user.name ?? "host yang minta"}`
                      : "pembayar menunggu surat sakit"}
                </span>
              )}
            </div>
          )}
          {letterError && <FormAlert tone="error">{letterError}</FormAlert>}
        </div>
      </div>

      {running && ["pending", "open", "filled"].includes(backup.status) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/20 px-4 py-3">
          {waiting && (
            <Button type="button" size="sm" variant={choosing ? "outline" : "default"} onClick={() => setChoosing(!choosing)} aria-expanded={choosing}>
              {choosing ? "Tutup" : backup.status === "pending" ? "Cek pendaftar" : "Tunjuk pengganti"}
              <ChevronDown className={cn("transition-transform", choosing && "rotate-180")} aria-hidden="true" />
            </Button>
          )}
          {backup.status === "filled" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onConfirm({
                  title: "Ganti pengganti?",
                  body: `${backup.filler?.user.name ?? "Pengganti"} dilepas tanpa penalti dan permintaan dibuka lagi.`,
                  label: "Lepas pengganti",
                  run: () => operatorBackupApi.unassign(token, backup.id),
                })
              }
            >
              Ganti pengganti
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() =>
              onConfirm({
                title: "Batalkan permintaan backup?",
                body: `Permintaan ${backup.requester?.user.name ?? "host"} untuk ${backup.brand.name}, ${formatWindow(backup.start_at, backup.end_at)}, dibatalkan seluruhnya.`,
                label: "Batalkan permintaan",
                run: () => operatorBackupApi.cancel(token, backup.id),
              })
            }
          >
            Batalkan permintaan
          </Button>
        </div>
      )}

      {choosing && waiting && (
        <div className="border-t border-border p-4">
          <CoverPicker backup={backup} act={act} onConfirm={onConfirm} />
        </div>
      )}
    </div>
  );
}

/** Applicants (ranked) plus, on demand, every other host for emergencies. */
function CoverPicker({ backup, act, onConfirm }: { backup: BackupRequest; act: Act; onConfirm: (confirm: Confirm) => void }) {
  const { token } = useAuth();
  const [showEveryone, setShowEveryone] = useState(false);
  const applicants = useApiData(`backup-applicants-${backup.id}`, () => operatorBackupApi.applicants(token, backup.id));
  const everyone = useApiData(`backup-everyone-${backup.id}-${showEveryone}`, () =>
    showEveryone ? operatorBackupApi.candidates(token, backup.id) : Promise.resolve({ candidates: [] })
  );

  const pick = (candidate: BackupCandidate) => act(() => operatorBackupApi.assign(token, backup.id, candidate.host_id));
  const reject = (candidate: BackupCandidate) =>
    onConfirm({
      title: `Tolak ${candidate.name}?`,
      body: "Kalau tidak ada pendaftar lain, permintaan dibuka lagi.",
      label: "Tolak pendaftar",
      run: () => operatorBackupApi.rejectApplicant(token, backup.id, candidate.host_id),
    });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">Pendaftar, terbaik di atas (rating tertinggi, lalu brand yang sama, lalu yang mendaftar paling awal).</p>
      {!applicants.data && <ListSkeleton rows={2} />}
      {applicants.data?.applicants.length === 0 && <p className="text-sm text-muted-foreground">Belum ada yang mendaftar.</p>}
      <CandidateList candidates={applicants.data?.applicants ?? []} onPick={pick} onReject={reject} />

      {showEveryone ? (
        <>
          <p className="pt-2 text-xs text-muted-foreground">Semua host (untuk darurat; tidak harus sudah mendaftar atau diminta).</p>
          {everyone.loading && !everyone.data?.candidates.length && <ListSkeleton rows={3} />}
          <CandidateList candidates={everyone.data?.candidates ?? []} onPick={pick} />
        </>
      ) : (
        <Button type="button" variant="link" size="sm" onClick={() => setShowEveryone(true)} className="h-auto px-0">
          <UserRoundPlus aria-hidden="true" />
          Tunjuk host yang tidak mendaftar
        </Button>
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  onPick,
  onReject,
}: {
  candidates: BackupCandidate[];
  onPick: (candidate: BackupCandidate) => void;
  /** Only for applicants */
  onReject?: (candidate: BackupCandidate) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {candidates.map((candidate, index) => (
        <li key={candidate.host_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
          {onReject && <span className="w-4 text-center text-xs font-semibold text-faint tabular-nums">{index + 1}</span>}
          <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="size-8 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{candidate.name}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {candidate.rating != null && (
                <span className="inline-flex items-center gap-0.5 font-medium text-foreground tabular-nums">
                  <Star className="size-3 fill-warning text-warning" aria-hidden="true" />
                  {candidate.rating.toFixed(1)}
                </span>
              )}
              <span>{candidate.same_brand ? "Brand yang sama" : `Brand lain · kuota ${candidate.quota.quota_used}/${candidate.quota.quota_max}`}</span>
              {candidate.ineligible_reason && <span className="text-destructive">· {candidate.ineligible_reason}</span>}
            </p>
          </div>
          <div className="flex gap-2">
            {onReject && (
              <Button type="button" size="sm" variant="outline" onClick={() => onReject(candidate)}>
                Tolak
              </Button>
            )}
            <Button type="button" size="sm" variant="success" disabled={!candidate.eligible} onClick={() => onPick(candidate)}>
              Setujui
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
