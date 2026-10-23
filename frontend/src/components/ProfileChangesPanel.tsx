"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, UserPen, X } from "lucide-react";
import { useQueryState } from "nuqs";
import { adminHostsApi, errorMessage, fieldErrors, type ProfileChangeRequest } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import Dialog from "./Dialog";
import ErrorState from "./ErrorState";
import FormAlert from "./FormAlert";
import { notify } from "./Toast";
import UserAvatar from "./UserAvatar";

/**
 * Admin: hosts' requests to add or change their personal data. Nothing changes on a host's
 * profile until it is approved here. Hidden while there is nothing to decide.
 */
export default function ProfileChangesPanel() {
  const { token } = useAuth();
  // Never served from cache: an admin approves KTP and bank details from this list
  const changes = useApiData("profile-changes", () => adminHostsApi.profileChanges(token), { staleTime: 0 });
  const invalidate = useInvalidate();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  // Opened from the "Perubahan data" notification
  const [fromLink, setFromLink] = useQueryState("changes");
  const panelRef = useRef<HTMLDivElement>(null);
  const list = changes.data?.requests ?? [];
  // Always the latest copy: the list loads again when a request is opened
  const reviewing = list.find((request) => request.id === reviewingId);

  function open(request: ProfileChangeRequest) {
    setReviewingId(request.id);
    changes.reload();
  }

  useEffect(() => {
    if (fromLink && list.length > 0) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [fromLink, list.length]);

  // A failed load isn't "nothing to decide": say so, or pending changes would go unnoticed
  if (changes.error && !changes.data) {
    return <ErrorState message={`Permintaan perubahan data belum bisa dimuat. ${changes.error}`} onRetry={changes.reload} />;
  }
  if (list.length === 0) return null;

  return (
    <div ref={panelRef} className="scroll-mt-20">
      <Card
        title={
          <span className="flex items-center gap-2">
            <UserPen className="size-4 text-warning" aria-hidden="true" />
            Permintaan perubahan data
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning tabular-nums">{list.length}</span>
          </span>
        }
        description="Host menambah atau mengubah data pribadinya. Data baru baru berlaku setelah disetujui."
        bodyClassName="px-0 pb-1 md:px-0"
      >
        <ul className="divide-y divide-border">
          {list.map((request) => (
            <li key={request.id}>
              <button
                type="button"
                onClick={() => open(request)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none md:px-6"
              >
                <UserAvatar user={{ name: request.host.name, avatar_url: request.host.avatar_url }} size="size-9" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{request.host.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {request.fields.map((field) => field.label).join(" · ")}
                  </span>
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{formatDateTime(request.created_at)}</span>
                <span className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground">Tinjau</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {reviewing && (
        <ReviewDialog
          key={reviewing.id}
          request={reviewing}
          loading={changes.loading}
          onStale={changes.reload}
          onClose={() => setReviewingId(null)}
          onDecided={(message) => {
            notify({ text: message });
            setReviewingId(null);
            void setFromLink(null);
            changes.reload();
            void invalidate("hosts-");
          }}
        />
      )}
    </div>
  );
}

/** What is saved next to what the host asked for, then approve or reject with a reason. */
function ReviewDialog({
  request,
  loading,
  onStale,
  onClose,
  onDecided,
}: {
  request: ProfileChangeRequest;
  /** The list is loading again: what is shown may be about to change. */
  loading: boolean;
  /** The server refused: load the latest values to look at. */
  onStale: () => void;
  onClose: () => void;
  onDecided: (message: string) => void;
}) {
  const { token } = useAuth();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(action: () => Promise<{ message: string }>) {
    setBusy(true);
    setError(null);
    try {
      onDecided((await action()).message);
    } catch (caught) {
      setBusy(false);
      const fields = fieldErrors(caught);
      // Already decided or cancelled: it leaves the list (and this dialog) on reload, so say why in a toast
      if (fields.request) notify({ text: fields.request, tone: "error" });
      else setError(errorMessage(caught));
      // Changed or decided meanwhile: show what is there now
      if (Object.keys(fields).length > 0) onStale();
    }
  }

  return (
    <Dialog
      title="Tinjau perubahan data"
      description={`${request.host.name} · ${request.host.email} · dikirim ${formatDateTime(request.created_at)}`}
      size="lg"
      onClose={onClose}
      dirty={rejecting && note.trim() !== ""}
      footer={
        rejecting ? (
          <>
            <Button type="button" variant="outline" onClick={() => setRejecting(false)} disabled={busy}>
              Kembali
            </Button>
            <Button type="button" variant="danger" disabled={busy || !note.trim()} onClick={() => decide(() => adminHostsApi.rejectChange(token, request.id, note.trim()))}>
              <X aria-hidden="true" />
              {busy ? "Menolak…" : "Tolak perubahan"}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => setRejecting(true)} disabled={busy} className="text-destructive hover:text-destructive">
              Tolak…
            </Button>
            <Button type="button" onClick={() => decide(() => adminHostsApi.approveChange(token, request.id, request.version))} disabled={busy || loading}>
              <Check aria-hidden="true" />
              {busy ? "Menyimpan…" : "Setujui & terapkan"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5">
        {error && <FormAlert tone="error">{error}</FormAlert>}

        {request.fields.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-muted/60 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="w-[30%] px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Saat ini</th>
                  <th className="w-6" aria-hidden="true" />
                  <th className="px-3 py-2 font-medium">Diminta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {request.fields.map((field) => (
                  <tr key={field.field}>
                    <td className="px-3 py-2.5 text-muted-foreground">{field.label}</td>
                    <td className={cn("px-3 py-2.5 break-words", field.current ? "text-foreground line-through decoration-muted-foreground/50" : "text-muted-foreground italic")}>
                      {field.current ?? "kosong"}
                    </td>
                    <td className="text-muted-foreground">
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </td>
                    <td className={cn("px-3 py-2.5 font-medium break-words", field.value ? "text-foreground" : "text-muted-foreground italic")}>
                      {field.value ?? "dikosongkan"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rejecting && (
          <div className="space-y-1.5">
            <Label htmlFor="reject-note">Alasan penolakan</Label>
            <Textarea
              id="reject-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={255}
              rows={3}
              autoFocus
              placeholder="mis. Nomor rekening tidak sesuai nama pemilik"
            />
            <p className="text-xs text-muted-foreground">Host melihat alasan ini di profilnya.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
