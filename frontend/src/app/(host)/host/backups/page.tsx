"use client";

import { useState } from "react";
import { ArrowLeftRight, Clock, Inbox, LifeBuoy, Plus, Upload } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import {
  errorMessage,
  hostBackupApi,
  settingsApi,
  type BackupNeed,
  type BackupReason,
  type BackupRequest,
  type BackupRequestType,
} from "@/lib/api";
import { formatDateTime, formatDuration, formatWindow } from "@/lib/format";
import { textareaClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { BackupStatusBadge, LetterBadge, reasonLabels, RequestTypeBadge } from "@/components/BackupBadges";
import Card from "@/components/Card";
import ConfirmDialog from "@/components/ConfirmDialog";
import Dialog from "@/components/Dialog";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { FieldError, FieldHint } from "@/components/FieldMessage";
import FormAlert from "@/components/FormAlert";
import { CardsSkeleton, ListSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import { NativeSelect } from "@/components/SelectField";
import StatusBadge from "@/components/StatusBadge";
import SubmitButton from "@/components/SubmitButton";
import { notify } from "@/components/Toast";
import ToggleGroup from "@/components/ToggleGroup";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["needs", "mine"] as const;
type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

export default function HostBackupsPage() {
  const { token } = useAuth();
  // The tab lives in the URL, so the dashboard can link straight to my requests (?tab=mine)
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("needs"));
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const mine = useApiData("backups-mine", () => hostBackupApi.mine(token));
  const needs = useApiData("backups-needs", () => hostBackupApi.needs(token));

  /** Run a button action, toast its message, refresh both lists. */
  async function act(action: () => Promise<{ message: string }>) {
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    }
    mine.reload();
    needs.reload();
  }

  const openRequests = mine.data?.requests.filter((request) => request.status === "open" || request.status === "pending").length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup"
        description="Gantikan host lain yang berhalangan, atau minta pengganti untuk sesimu."
        actions={
          <Button type="button" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" />
            Saya butuh backup
          </Button>
        }
      />

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {(mine.error || needs.error) && <ErrorState message={(mine.error ?? needs.error)!} onRetry={() => (mine.reload(), needs.reload())} />}

      <Tabs value={tab} onValueChange={(value) => void setTab(value as (typeof TABS)[number])} className="gap-5">
        <TabsList className="h-10 w-full sm:w-fit">
          <TabsTrigger value="needs" className="px-3">
            Butuh pengganti
            {needs.data && needs.data.needs.length > 0 && <CountPill>{needs.data.needs.length}</CountPill>}
          </TabsTrigger>
          <TabsTrigger value="mine" className="px-3">
            Permintaan saya
            {openRequests > 0 && <CountPill>{openRequests}</CountPill>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="needs">
          <NeedsTab covers={mine.data?.covers ?? []} needs={needs.data?.needs} quota={mine.data?.quota} act={act} />
        </TabsContent>
        <TabsContent value="mine">
          <MineTab requests={mine.data?.requests} act={act} onNew={() => setFormOpen(true)} />
        </TabsContent>
      </Tabs>

      {formOpen && (
        <RequestForm
          onDone={(message) => {
            setFormOpen(false);
            void setTab("mine");
            notify({ text: message });
            mine.reload();
          }}
          onCancel={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}

function CountPill({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 rounded-full bg-primary/12 px-1.5 text-[11px] font-semibold text-brand tabular-nums">{children}</span>;
}

function NeedsTab({
  covers,
  needs,
  quota,
  act,
}: {
  covers: BackupNeed[];
  needs?: BackupNeed[];
  quota?: { quota_used: number; quota_max: number };
  act: Act;
}) {
  const { token } = useAuth();
  const [dropping, setDropping] = useState<BackupNeed | null>(null);
  const upcomingCovers = covers.filter((cover) => new Date(cover.end_at) > new Date());

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-3">
        {!needs && <CardsSkeleton count={2} />}
        {needs?.length === 0 && (
          <Card>
            <EmptyState icon={Inbox} title="Tidak ada yang butuh backup" description="Kami beri tahu lewat notifikasi kalau ada host yang butuh pengganti." />
          </Card>
        )}

        <ul className="grid gap-3 xl:grid-cols-2">
          {needs?.map((need) => {
            const applied = need.my_application?.status === "applied";
            return (
              <li key={need.id} className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-xs dark:shadow-none", need.asked_me ? "border-primary/40" : "border-border")}>
                {need.asked_me && <StatusBadge tone="brand">{need.requester_name} meminta kamu</StatusBadge>}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{need.brand.name}</p>
                    <p className="flex items-center gap-1.5 text-sm text-body tabular-nums">
                      <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {formatWindow(need.start_at, need.end_at)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      untuk {need.requester_name} · {need.same_brand ? "brand kamu" : "brand lain (memakai kuota)"}
                    </p>
                  </div>
                  {applied ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => act(() => hostBackupApi.withdraw(token, need.id))}>
                      Tarik diri
                    </Button>
                  ) : (
                    <Button type="button" size="sm" disabled={Boolean(need.ineligible_reason)} onClick={() => act(() => hostBackupApi.apply(token, need.id))}>
                      Daftar
                    </Button>
                  )}
                </div>
                {!need.asked_me && <RequestTypeBadge names={need.nominee_names} />}
                {applied && <p className="text-xs font-medium text-success">Kamu sudah mendaftar. Menunggu persetujuan admin.</p>}
                {!applied && need.ineligible_reason && <p className="text-xs text-muted-foreground">{need.ineligible_reason}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-6 lg:sticky lg:top-20">
        <Card title="Kamu menggantikan">
          {upcomingCovers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada sesi yang kamu gantikan.</p>
          ) : (
            <ul className="space-y-2">
              {upcomingCovers.map((cover) => (
                <li key={cover.id} className="space-y-1 rounded-lg border border-l-[3px] border-border border-l-success px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground">{cover.brand.name}</p>
                  <p className="text-xs text-body tabular-nums">{formatWindow(cover.start_at, cover.end_at)}</p>
                  <p className="text-xs text-muted-foreground">untuk {cover.requester_name}</p>
                  {new Date(cover.start_at) > new Date() && (
                    <Button type="button" variant="link" size="xs" onClick={() => setDropping(cover)} className="h-auto p-0 text-destructive">
                      Saya tidak bisa
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {quota && (
          <Card title="Kuota brand lain" description="Menggantikan di brand sendiri tidak dihitung.">
            <div className="space-y-1.5">
              <p className="text-sm text-body">
                <span className="text-lg font-semibold text-foreground tabular-nums">{quota.quota_used}</span> / {quota.quota_max} bulan ini
              </p>
              <Progress value={(quota.quota_used / Math.max(1, quota.quota_max)) * 100} aria-label="Kuota backup brand lain" className="h-1.5" />
            </div>
          </Card>
        )}
      </div>

      {dropping && (
        <ConfirmDialog
          title="Batal jadi backup?"
          confirmLabel="Ya, saya tidak bisa"
          onConfirm={() => act(() => hostBackupApi.drop(token, dropping.id))}
          onClose={() => setDropping(null)}
        >
          Permintaan {dropping.brand.name} ({formatWindow(dropping.start_at, dropping.end_at)}) dibuka lagi untuk host lain, dan kamu kena potongan poin.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Who pays the host covering my session: the agency only for sickness with the letter on time. */
function coverPayNote(paidBy: BackupRequest["cover_paid_by"], cover: string): string {
  if (paidBy === "agency") return `Agensi yang membayar ${cover} karena surat sakitmu masuk tepat waktu.`;
  if (paidBy === "requester") return `Kamu yang membayar ${cover} langsung untuk sesi ini, di luar gaji dari agensi.`;
  return `Unggah surat sakit sebelum batas supaya agensi yang membayar ${cover}. Tanpa surat, kamu yang membayarnya langsung.`;
}

function MineTab({ requests, act, onNew }: { requests?: BackupRequest[]; act: Act; onNew: () => void }) {
  const { token } = useAuth();
  const [cancelling, setCancelling] = useState<BackupRequest | null>(null);

  if (!requests) return <ListSkeleton rows={3} />;

  if (requests.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={LifeBuoy}
          title="Belum pernah mengajukan backup"
          description="Kalau berhalangan live, ajukan backup supaya host lain bisa menggantikan."
          action={
            <Button type="button" variant="outline" onClick={onNew}>
              <Plus aria-hidden="true" />
              Saya butuh backup
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <ul className="grid gap-3 lg:grid-cols-2">
        {requests.map((backup) => (
          <li key={backup.id} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs dark:shadow-none">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{backup.brand.name}</p>
                <p className="text-sm text-body tabular-nums">{formatWindow(backup.start_at, backup.end_at)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {reasonLabels[backup.reason_type]}
                  {backup.reason && ` · ${backup.reason}`}
                </p>
              </div>
              <BackupStatusBadge status={backup.status} />
            </div>

            <RequestTypeBadge names={backup.nominees?.map((nominee) => nominee.host.user.name) ?? []} />

            {backup.status === "filled" && backup.filler && (
              <div className="space-y-0.5">
                <p className="flex items-center gap-2 text-sm text-success">
                  <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                  Digantikan {backup.filler.user.name}
                </p>
                <p className="text-xs text-muted-foreground">{coverPayNote(backup.cover_paid_by, backup.filler.user.name)}</p>
              </div>
            )}
            {backup.status === "open" && <p className="text-xs text-muted-foreground">Menunggu host mendaftar.</p>}
            {backup.status === "pending" && <p className="text-xs text-muted-foreground">Sudah ada yang mendaftar. Admin akan memilih penggantinya.</p>}

            {backup.letter_status !== "not_needed" && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2">
                <div className="min-w-0">
                  <LetterBadge status={backup.letter_status} />
                  {backup.letter_status !== "uploaded" && backup.letter_due_at && (
                    <p className="text-xs text-muted-foreground">batas {formatDateTime(backup.letter_due_at)}</p>
                  )}
                </div>
                <Button asChild variant="outline" size="sm" className="cursor-pointer">
                  <label>
                    <Upload aria-hidden="true" />
                    {backup.letter_status === "uploaded" ? "Ganti surat" : "Unggah surat"}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) act(() => hostBackupApi.uploadLetter(token, backup.id, file));
                      }}
                    />
                  </label>
                </Button>
              </div>
            )}

            {(backup.status === "pending" || backup.status === "open") && (
              <div className="flex justify-end border-t border-border pt-3">
                <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(backup)} className="text-destructive hover:text-destructive">
                  Batalkan permintaan
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {cancelling && (
        <ConfirmDialog
          title="Batalkan permintaan backup?"
          confirmLabel="Batalkan permintaan"
          cancelLabel="Kembali"
          onConfirm={() => act(() => hostBackupApi.cancel(token, cancelling.id))}
          onClose={() => setCancelling(null)}
        >
          {cancelling.brand.name}, {formatWindow(cancelling.start_at, cancelling.end_at)}. Kamu tetap harus live di sesi ini.
        </ConfirmDialog>
      )}
    </>
  );
}

const requestTypes: { value: BackupRequestType; label: string; hint: string }[] = [
  { value: "open", label: "Siapa saja", hint: "Semua host bisa mendaftar." },
  { value: "direct", label: "Pilih host", hint: "Hanya host yang kamu pilih yang bisa mendaftar." },
];

function RequestForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const settings = useApiData("public-settings", () => settingsApi.public(token)).data?.settings;
  const slots = useApiData("backup-slots", () => hostBackupApi.slots(token));
  const [reasonType, setReasonType] = useState<BackupReason>("sick");
  const [requestType, setRequestType] = useState<BackupRequestType>("open");
  const [pickedOccurrence, setPickedOccurrence] = useState("");
  const [hostIds, setHostIds] = useState<string[]>([]);

  const firstSlot = slots.data?.slots[0];
  const occurrence = pickedOccurrence || (firstSlot ? `${firstSlot.slot_id}|${firstSlot.date}` : "");
  const [slotId, date] = occurrence.split("|");

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => {
      const letter = data.get("letter");
      return hostBackupApi.request(token, {
        slot_id: slotId,
        backup_date: date,
        reason_type: reasonType,
        reason: formValue(data, "reason") || null,
        request_type: requestType,
        host_ids: hostIds,
        letter: letter instanceof File && letter.size > 0 ? letter : null,
      });
    },
    ({ message }) => onDone(message),
    ["slot_id", "backup_date", "host_ids"]
  );

  // Nothing to request for (yet): no form, so it can't be sent without a session
  if (!occurrence) {
    return (
      <Dialog
        title="Ajukan backup"
        size="sm"
        onClose={onCancel}
        footer={
          <Button type="button" variant="outline" onClick={onCancel}>
            Tutup
          </Button>
        }
      >
        {slots.error && <FormAlert tone="error">{slots.error}</FormAlert>}
        {!slots.data && !slots.error && <ListSkeleton rows={2} />}
        {slots.data && (
          <EmptyState
            compact
            icon={Clock}
            title="Tidak ada sesi yang bisa diajukan"
            description={
              settings
                ? `Sesi yang kurang dari ${formatDuration(settings["backup.request_min_hours_before"])} lagi tidak ditampilkan. Kalau mendadak tidak bisa, hubungi admin.`
                : undefined
            }
          />
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Ajukan backup"
      description="Pilih sesi yang tidak bisa kamu jalani. Langsung masuk ke papan backup; admin yang menyetujui penggantinya."
      onClose={onCancel}
      closeOnOutsideClick={false}
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <FormAlert tone="error">{error}</FormAlert>}

        <div className="space-y-1.5">
          <Label htmlFor="occurrence">Sesi</Label>
          <NativeSelect
            id="occurrence"
            value={occurrence}
            onChange={(event) => {
              setPickedOccurrence(event.target.value);
              setHostIds([]); // who is free depends on the session
            }}
          >
            {slots.data?.slots.map((slot) => (
              <option key={`${slot.slot_id}|${slot.date}`} value={`${slot.slot_id}|${slot.date}`}>
                {formatWindow(slot.start_at, slot.end_at)} · {slot.brand.name}
              </option>
            ))}
          </NativeSelect>
          {errors.slot_id || errors.backup_date ? (
            <FieldError>{errors.slot_id ?? errors.backup_date}</FieldError>
          ) : (
            settings && (
              <FieldHint>
                Ajukan paling lambat {formatDuration(settings["backup.request_min_hours_before"])} sebelum sesi. Kalau lebih mendadak, hubungi admin.
              </FieldHint>
            )
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Alasan</p>
          <ToggleGroup
            label="Alasan"
            options={(Object.keys(reasonLabels) as BackupReason[]).map((value) => [value, reasonLabels[value]] as const)}
            value={reasonType}
            onChange={setReasonType}
            className="grid w-full grid-cols-3"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reason">
            Keterangan <span className="font-normal text-muted-foreground">(opsional)</span>
          </Label>
          <textarea id="reason" name="reason" rows={2} maxLength={1000} className={textareaClass} />
          <FieldError>{errors.reason}</FieldError>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="letter">
            {reasonType === "sick" ? "Surat dokter" : "Lampiran"} <span className="font-normal text-muted-foreground">(boleh menyusul)</span>
          </Label>
          <input
            id="letter"
            name="letter"
            type="file"
            accept="image/*,application/pdf"
            className="block w-full rounded-lg border border-dashed border-input bg-muted/40 p-2 text-sm text-body file:mr-3 file:rounded-md file:border-0 file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground file:shadow-xs"
          />
          {errors.letter ? (
            <FieldError>{errors.letter}</FieldError>
          ) : (
            reasonType === "sick" &&
            settings && (
              <FieldHint>
                Kalau belum ada, unggah paling lambat {formatDuration(settings["backup.sick_letter_grace_hours"])} setelah sesi dimulai, atau poinmu
                dipotong.
              </FieldHint>
            )
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Siapa yang bisa menggantikan</p>
          <ToggleGroup
            label="Siapa yang bisa menggantikan"
            options={requestTypes.map((option) => [option.value, option.label] as const)}
            value={requestType}
            onChange={setRequestType}
            className="grid w-full grid-cols-2"
          />
          <FieldHint>{requestTypes.find((option) => option.value === requestType)?.hint}</FieldHint>
          {requestType === "direct" && occurrence && settings && (
            <NomineePicker
              slotId={slotId}
              date={date}
              min={settings["backup.direct_min_hosts"]}
              max={settings["backup.direct_max_hosts"]}
              selected={hostIds}
              onChange={setHostIds}
            />
          )}
          <FieldError>{errors.host_ids}</FieldError>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="lg" onClick={onCancel}>
            Batal
          </Button>
          <SubmitButton loading={loading} className="sm:w-auto">
            Kirim permintaan
          </SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}

/** Tick the hosts to ask; busy or unavailable hosts can't be picked. */
function NomineePicker({
  slotId,
  date,
  min,
  max,
  selected,
  onChange,
}: {
  slotId: string;
  date: string;
  min: number;
  max: number;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { token } = useAuth();
  const candidates = useApiData(`nominees-${slotId}-${date}`, () => hostBackupApi.candidates(token, slotId, date));
  const full = selected.length >= max;

  function toggle(hostId: string) {
    onChange(selected.includes(hostId) ? selected.filter((id) => id !== hostId) : [...selected, hostId]);
  }

  return (
    <div className="space-y-2 pt-2">
      <p className="text-xs text-body">
        Dipilih <span className="font-semibold text-foreground tabular-nums">{selected.length}</span> · pilih {min} sampai {max} host
      </p>
      {candidates.error && <FormAlert tone="error">{candidates.error}</FormAlert>}
      {candidates.loading && !candidates.data && <ListSkeleton rows={3} />}
      <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {candidates.data?.candidates.map((candidate) => {
          const checked = selected.includes(candidate.host_id);
          const disabled = !candidate.eligible || (full && !checked);

          return (
            <li key={candidate.host_id}>
              <label
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                  checked ? "border-primary/40 bg-primary/[0.06]" : "border-border",
                  disabled ? "opacity-50" : "cursor-pointer hover:bg-muted/60"
                )}
              >
                <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggle(candidate.host_id)} />
                <UserAvatar user={{ name: candidate.name, avatar_url: candidate.avatar_url }} size="size-7 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{candidate.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{candidate.ineligible_reason ?? (candidate.same_brand ? "Brand kamu" : "Brand lain")}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
