"use client";

import { useEffect, useRef, useState } from "react";
import { Flag, MessageSquareWarning, Search, ShieldAlert, ThumbsUp, Users } from "lucide-react";
import { errorMessage, operatorApi, pointsApi, type PointLog, type PointsHostDetail, type ViolationType } from "@/lib/api";
import { formatDate, formatShortDate, toDateInput } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-mobile";
import { inputClass, textareaClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import ConfirmDialog from "./ConfirmDialog";
import Dialog from "./Dialog";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import { FieldError, FieldHint } from "./FieldMessage";
import FormActions from "./FormActions";
import FormAlert from "./FormAlert";
import { CardsSkeleton, ListSkeleton } from "./Loading";
import Modal from "./Modal";
import PointsMeter, { SpBadge } from "./PointsMeter";
import { NativeSelect } from "./SelectField";
import { notify } from "./Toast";
import UserAvatar from "./UserAvatar";

export const sourceLabels: Record<PointLog["source"], string> = {
  internal: "Pelanggaran",
  brand_complaint: "Komplain brand",
  backup_cancel: "Membatalkan backup (otomatis)",
  late_attachment: "Surat sakit terlambat (otomatis)",
};

/**
 * Points desk: every host's points this period, and one host's history with
 * forms to record a violation or a brand complaint. Admins can also correct entries and SPs.
 * Laptops show the host beside the list; phones open it as a sheet.
 */
export default function PointsDesk({ isAdmin = false }: { isAdmin?: boolean }) {
  const { token } = useAuth();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hosts = useApiData(`points-${search}`, () => pointsApi.hosts(token, search));
  const wide = useMediaQuery("(min-width: 1024px)");

  useEffect(() => () => clearTimeout(debounce.current), []);

  const hostId = selected ?? (wide ? hosts.data?.hosts[0]?.host_id : null) ?? null;
  const list = hosts.data?.hosts;

  const detail = hostId && (
    <HostPoints
      key={hostId}
      hostId={hostId}
      isAdmin={isAdmin}
      onChanged={(message, tone = "success") => {
        if (tone === "success") notify({ text: message });
        else setError(message);
        hosts.reload();
      }}
    />
  );

  return (
    <div className="space-y-4">
      {hosts.data && (
        <p className="text-sm text-muted-foreground">
          Periode poin <span className="font-medium text-foreground">{formatDate(hosts.data.period.start)} – {formatDate(hosts.data.period.end)}</span>. Semua mulai
          dari 100; SP terbit otomatis di{" "}
          {Object.entries(hosts.data.thresholds)
            .map(([level, points]) => `SP${level} ≤ ${points}`)
            .join(", ")}
          .
        </p>
      )}
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {hosts.error && <ErrorState message={hosts.error} onRetry={hosts.reload} />}

      <div className="grid items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
        <div className="space-y-2 lg:sticky lg:top-20">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                clearTimeout(debounce.current);
                debounce.current = setTimeout(() => setSearch(next.trim()), 300);
              }}
              placeholder="Cari host…"
              aria-label="Cari host"
              className={cn(inputClass, "pl-9")}
            />
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
            {!list && !hosts.error && <ListSkeleton rows={5} className="p-3" />}
            {list?.length === 0 && <EmptyState compact icon={Users} title="Tidak ada host aktif" />}
            <ul className={cn("max-h-[calc(100dvh-16rem)] divide-y divide-border overflow-y-auto transition-opacity", hosts.loading && list && "opacity-60")}>
              {list?.map((host) => {
                const active = host.host_id === hostId;
                return (
                  <li key={host.host_id}>
                    <button
                      type="button"
                      onClick={() => setSelected(host.host_id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors outline-none focus-visible:bg-muted",
                        active ? "bg-primary/[0.07]" : "hover:bg-muted/60"
                      )}
                    >
                      <UserAvatar user={host} size="size-8 text-xs" />
                      <span className={cn("min-w-0 flex-1 truncate text-sm", active ? "font-medium text-foreground" : "text-body")}>{host.name}</span>
                      <SpBadge level={host.sp_level} />
                      <span className={cn("w-8 text-right text-sm font-semibold tabular-nums", host.points < 100 ? "text-warning" : "text-muted-foreground")}>
                        {host.points}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {wide ? (
          detail || <CardsSkeleton count={2} />
        ) : (
          hostId && (
            <Dialog title="Poin host" placement="side" size="lg" onClose={() => setSelected(null)}>
              {detail}
            </Dialog>
          )
        )}
      </div>
    </div>
  );
}

type Act = (action: () => Promise<{ message: string }>) => Promise<void>;

function HostPoints({ hostId, isAdmin, onChanged }: { hostId: string; isAdmin: boolean; onChanged: (message: string, tone?: "success" | "error") => void }) {
  const { token } = useAuth();
  const detail = useApiData(`points-host-${hostId}`, () => pointsApi.host(token, hostId));
  const [form, setForm] = useState<"violation" | "complaint" | "sp" | null>(null);
  const [voiding, setVoiding] = useState<PointLog | null>(null);

  async function act(action: () => Promise<{ message: string }>) {
    try {
      onChanged((await action()).message);
    } catch (caught) {
      onChanged(errorMessage(caught), "error");
    }
    detail.reload();
  }

  const done = (message: string) => {
    setForm(null);
    onChanged(message);
    detail.reload();
  };

  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <CardsSkeleton count={2} />;
  const data = detail.data;

  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <UserAvatar user={data.host.user} size="size-11 text-sm" />
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{data.host.user.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(data.period.start)} – {formatDate(data.period.end)}
            </p>
          </div>
        </div>
        <PointsMeter points={data.points} opening={data.opening_points} thresholds={data.thresholds} />
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" size="sm" onClick={() => setForm("violation")}>
            <Flag aria-hidden="true" />
            Catat pelanggaran
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setForm("complaint")}>
            <MessageSquareWarning aria-hidden="true" />
            Komplain brand
          </Button>
          {isAdmin && (
            <Button type="button" variant="outline" size="sm" onClick={() => setForm("sp")}>
              <ShieldAlert aria-hidden="true" />
              Terbitkan SP manual
            </Button>
          )}
        </div>
        {form === "violation" && (
          <Modal title={`Catat pelanggaran · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <ViolationForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
        {form === "complaint" && (
          <Modal title={`Komplain brand · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <ComplaintForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
        {form === "sp" && (
          <Modal title={`Terbitkan SP manual · ${data.host.user.name}`} onClose={() => setForm(null)}>
            <WarningForm hostId={hostId} onDone={done} onCancel={() => setForm(null)} />
          </Modal>
        )}
      </Card>

      <Card title="Periode ini">
        {data.logs.length === 0 ? (
          <EmptyState compact icon={ThumbsUp} title="Tidak ada potongan" />
        ) : (
          <ul className="divide-y divide-border">
            {data.logs.map((log) => (
              <li key={log.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cn("text-sm font-medium", log.voided_at ? "text-faint line-through" : "text-foreground")}>
                      {log.violation_type?.name ?? sourceLabels[log.source]}
                      {log.brand_complaint && <span className="font-normal text-muted-foreground"> · {log.brand_complaint.brand.name}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatShortDate(log.occurred_on)} · {sourceLabels[log.source]}
                      {log.recorder ? ` · oleh ${log.recorder.name}` : ""}
                      {log.voided_at ? " · dibatalkan" : ""}
                    </p>
                    {log.reason && <p className="mt-1 text-xs text-body">{log.reason}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn("text-sm font-semibold tabular-nums", log.voided_at ? "text-faint" : log.points_change < 0 ? "text-destructive" : "text-success")}>
                      {log.points_change > 0 ? "+" : ""}
                      {log.points_change}
                    </span>
                    {isAdmin && !log.voided_at && (
                      <Button type="button" variant="link" size="xs" onClick={() => setVoiding(log)} className="h-auto px-0 text-destructive">
                        Batalkan
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <WarningsCard data={data} isAdmin={isAdmin} act={act} />

      {voiding && (
        <ConfirmDialog
          title="Batalkan catatan ini?"
          confirmLabel="Batalkan catatan"
          cancelLabel="Kembali"
          onConfirm={() => act(() => pointsApi.voidLog(token, voiding.id))}
          onClose={() => setVoiding(null)}
        >
          {voiding.violation_type?.name ?? sourceLabels[voiding.source]} ({voiding.points_change}) pada {formatShortDate(voiding.occurred_on)}. Poinnya
          dikembalikan ke host.
        </ConfirmDialog>
      )}
    </div>
  );
}

function WarningsCard({ data, isAdmin, act }: { data: PointsHostDetail; isAdmin: boolean; act: Act }) {
  const { token } = useAuth();
  const [voiding, setVoiding] = useState<PointsHostDetail["warning_letters"][number] | null>(null);

  return (
    <Card title="Surat peringatan">
      {data.warning_letters.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada surat peringatan.</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.warning_letters.map((letter) => (
            <li key={letter.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              {letter.voided_at ? <span className="text-xs text-faint line-through">SP{letter.level}</span> : <SpBadge level={letter.level} />}
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", letter.voided_at ? "text-faint line-through" : "text-foreground")}>{letter.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(letter.issued_at)} · {letter.issuer ? `oleh ${letter.issuer.name}` : "otomatis"}
                  {letter.voided_at ? " · dibatalkan" : ""}
                </p>
              </div>
              {isAdmin && !letter.voided_at && (
                <Button type="button" variant="link" size="xs" onClick={() => setVoiding(letter)} className="h-auto px-0 text-destructive">
                  Batalkan
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {voiding && (
        <ConfirmDialog
          title={`Batalkan SP${voiding.level}?`}
          confirmLabel="Batalkan SP"
          cancelLabel="Kembali"
          onConfirm={() => act(() => pointsApi.voidWarning(token, voiding.id))}
          onClose={() => setVoiding(null)}
        >
          {voiding.reason}
        </ConfirmDialog>
      )}
    </Card>
  );
}

type FormProps = { hostId: string; onDone: (message: string) => void; onCancel: () => void };

function ViolationForm({ hostId, onDone, onCancel }: FormProps) {
  const { token } = useAuth();
  const types = useApiData("violation-types", () => pointsApi.violationTypes(token));
  const [typeId, setTypeId] = useState("");
  const chosen: ViolationType | undefined = types.data?.violation_types.find((type) => type.id === typeId) ?? types.data?.violation_types[0];

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      pointsApi.recordViolation(token, {
        host_id: hostId,
        violation_type_id: chosen?.id ?? "",
        points: formValue(data, "points") ? Number(formValue(data, "points")) : null,
        reason: formValue(data, "reason") || null,
        occurred_on: formValue(data, "occurred_on"),
      }),
    ({ message }) => onDone(message)
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="violation-type">Pelanggaran</Label>
        <NativeSelect id="violation-type" value={chosen?.id ?? ""} onChange={(event) => setTypeId(event.target.value)}>
          {types.data?.violation_types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name} (−{type.default_points})
            </option>
          ))}
        </NativeSelect>
        <FieldError>{errors.violation_type_id}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="violation-points">Poin yang dipotong</Label>
        <input
          id="violation-points"
          key={chosen?.id}
          name="points"
          type="number"
          min={1}
          max={100}
          placeholder={String(chosen?.default_points ?? "")}
          className={cn(inputClass, "tabular-nums")}
        />
        {errors.points ? <FieldError>{errors.points}</FieldError> : <FieldHint>Kosongkan untuk memakai nilai bawaan.</FieldHint>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="violation-date">Tanggal</Label>
        <input id="violation-date" name="occurred_on" type="date" defaultValue={toDateInput()} max={toDateInput()} className={cn(inputClass, "tabular-nums")} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="violation-reason">Kejadiannya</Label>
        <input id="violation-reason" name="reason" maxLength={255} className={inputClass} />
      </div>
      <FormActions loading={loading} submitLabel="Catat" onCancel={onCancel} />
    </form>
  );
}

function ComplaintForm({ hostId, onDone, onCancel }: FormProps) {
  const { token } = useAuth();
  const brands = useApiData("brands", () => operatorApi.brands(token));

  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      pointsApi.recordComplaint(token, {
        host_id: hostId,
        brand_id: formValue(data, "brand_id"),
        description: formValue(data, "description"),
        points: formValue(data, "points") ? Number(formValue(data, "points")) : null,
        occurred_on: formValue(data, "occurred_on"),
      }),
    ({ message }) => onDone(message)
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="complaint-brand">Brand</Label>
        <NativeSelect id="complaint-brand" name="brand_id">
          {brands.data?.brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="complaint-points">Poin yang dipotong</Label>
        <input id="complaint-points" name="points" type="number" min={1} max={100} className={cn(inputClass, "tabular-nums")} />
        <FieldHint>Kosongkan untuk memakai nilai bawaan.</FieldHint>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="complaint-description">Keluhan dari brand</Label>
        <textarea id="complaint-description" name="description" rows={3} maxLength={2000} className={textareaClass} />
        <FieldError>{errors.description}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="complaint-date">Tanggal</Label>
        <input id="complaint-date" name="occurred_on" type="date" defaultValue={toDateInput()} max={toDateInput()} className={cn(inputClass, "tabular-nums")} />
      </div>
      <FormActions loading={loading} submitLabel="Catat" onCancel={onCancel} />
    </form>
  );
}

function WarningForm({ hostId, onDone, onCancel }: FormProps) {
  const { token } = useAuth();
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      pointsApi.issueWarning(token, {
        host_id: hostId,
        level: Number(formValue(data, "level")),
        reason: formValue(data, "reason"),
      }),
    ({ message }) => onDone(message)
  );

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-[8rem_1fr]" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <FormAlert tone="error">{error}</FormAlert>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="warning-level">Level</Label>
        <NativeSelect id="warning-level" name="level">
          <option value="1">SP1</option>
          <option value="2">SP2</option>
          <option value="3">SP3</option>
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="warning-reason">Alasan</Label>
        <input id="warning-reason" name="reason" maxLength={255} className={inputClass} />
        <FieldError>{errors.reason}</FieldError>
      </div>
      <FormActions loading={loading} submitLabel="Terbitkan" onCancel={onCancel} />
    </form>
  );
}

