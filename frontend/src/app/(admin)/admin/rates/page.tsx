"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Hand, Pencil, Plus, Trash2, TrendingUp, Users } from "lucide-react";
import { adminHostsApi, errorMessage, type PinnedRateHost, type RateCategory, type RateCategoryInput, type RatePromotion } from "@/lib/api";
import { formatRupiah, formatShortDate } from "@/lib/format";
import { inputClass } from "@/lib/ui";
import { useApiData } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import { FieldError } from "@/components/FieldMessage";
import PageHeader from "@/components/PageHeader";
import RupiahInput from "@/components/RupiahInput";
import { notify } from "@/components/Toast";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Level = RateCategory & { hosts_count: number };

/** One color per level, in ladder order (bars and legend). */
const LEVEL_FILLS = ["bg-chart-1", "bg-chart-3", "bg-chart-4", "bg-chart-2", "bg-chart-5"];
const fillOf = (index: number) => LEVEL_FILLS[index % LEVEL_FILLS.length];

/** 0 → "Sejak bergabung", 12 → "Masa kerja 1 tahun", 18 → "Masa kerja 18 bulan" */
function tenureLabel(months: number): string {
  if (months === 0) return "Sejak bergabung";
  return months % 12 === 0 ? `Masa kerja ${months / 12} tahun` : `Masa kerja ${months} bulan`;
}

/**
 * The rate levels as a ladder by tenure (read first, edit on demand), and beside it what they mean
 * for the hosts: how they spread over the levels, who moves up soon, who is placed by hand.
 */
export default function AdminRatesPage() {
  const { token } = useAuth();
  const data = useApiData("rates", () => adminHostsApi.rateCategories(token));
  const levels = data.data?.rate_categories;
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Level tarif"
        description="Tarif per jam naik mengikuti masa kerja: setiap malam host pindah ke level tertinggi yang sudah dicapainya, kecuali levelnya diatur manual di halaman Host. Mengubah level di sini langsung menempatkan ulang para host."
        actions={
          levels && (
            <Button type="button" onClick={() => setAdding(true)} disabled={adding}>
              <Plus aria-hidden="true" />
              Tambah level
            </Button>
          )
        }
      />

      {data.error && <ErrorState message={data.error} onRetry={data.reload} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        {/* The ladder, then who climbs it soon */}
        <section aria-label="Level tarif berdasarkan masa kerja" className="space-y-6">
          {!levels && !data.error && (
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-32 rounded-xl" />
              ))}
            </div>
          )}
          {levels && (
            <ol className="space-y-3">
              {levels.map((level, index) => (
                <LevelStep
                  key={`${level.id}-${level.rate_per_hour}-${level.min_tenure_months}-${level.name}`}
                  level={level}
                  previous={levels[index - 1]}
                  index={index}
                  last={index === levels.length - 1 && !adding}
                  onChanged={data.reload}
                />
              ))}
              {adding ? (
                <Step index={levels.length} last tone="new">
                  <LevelForm
                    onDone={() => {
                      setAdding(false);
                      data.reload();
                    }}
                    onCancel={() => setAdding(false)}
                  />
                </Step>
              ) : (
                levels.length === 0 && (
                  <li className="rounded-xl border border-dashed border-input bg-card/50">
                    <EmptyState icon={TrendingUp} title="Belum ada level tarif" description="Tambahkan level pertama untuk host yang baru bergabung." />
                  </li>
                )
              )}
            </ol>
          )}
          {data.data && <Upcoming promotions={data.data.upcoming} days={data.data.upcoming_days} />}
        </section>

        {/* How the hosts sit on the levels */}
        <aside className="space-y-4">
          {!levels && !data.error && <Skeleton className="h-64 rounded-xl" />}
          {levels && levels.length > 0 && <Spread levels={levels} />}
          {data.data && <Pinned hosts={data.data.pinned} />}
        </aside>
      </div>
    </div>
  );
}

/** A rung of the ladder: its number on the rail, then the card. */
function Step({ index, last, tone = "level", children }: { index: number; last: boolean; tone?: "level" | "new"; children: React.ReactNode }) {
  return (
    <li className="relative pl-12">
      {!last && <span className="absolute top-10 -bottom-3 left-[15px] w-px bg-border" aria-hidden="true" />}
      <span
        className={cn(
          "absolute top-3 left-0 flex size-8 items-center justify-center rounded-full text-sm font-semibold ring-4 ring-background",
          tone === "new" ? "bg-muted text-muted-foreground" : cn(fillOf(index), "text-white")
        )}
        aria-hidden="true"
      >
        {tone === "new" ? <Plus className="size-4" /> : index + 1}
      </span>
      {children}
    </li>
  );
}

function LevelStep({ level, previous, index, last, onChanged }: { level: Level; previous?: Level; index: number; last: boolean; onChanged: () => void }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rate = Number(level.rate_per_hour);
  const raise = previous ? rate - Number(previous.rate_per_hour) : 0;
  const raisePercent = previous && Number(previous.rate_per_hour) > 0 ? Math.round((raise / Number(previous.rate_per_hour)) * 100) : null;

  async function remove() {
    try {
      await adminHostsApi.deleteRateCategory(token, level.id);
      notify({ text: `Level ${level.name} dihapus` });
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Step index={index} last={last}>
      <div className="rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        {editing ? (
          <div className="p-4">
            <LevelForm
              level={level}
              onDone={() => {
                setEditing(false);
                onChanged();
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  {tenureLabel(level.min_tenure_months)}
                  {level.min_tenure_months > 0 && <span className="text-faint"> · mulai bulan ke-{level.min_tenure_months}</span>}
                </p>
                <h2 className="mt-0.5 truncate text-base font-semibold text-foreground">{level.name}</h2>
              </div>
              <div className="sm:text-right">
                <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                  {formatRupiah(rate)}
                  <span className="text-sm font-medium text-muted-foreground"> /jam</span>
                </p>
                {previous && (
                  <p className={cn("text-xs font-medium tabular-nums", raise >= 0 ? "text-success" : "text-destructive")}>
                    {raise >= 0 ? "+" : "−"}
                    {formatRupiah(Math.abs(raise))}
                    {raisePercent !== null && ` (${raise >= 0 ? "+" : "−"}${Math.abs(raisePercent)}%)`} dari {previous.name}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2">
              <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" aria-hidden="true" />
                <span className="font-medium text-foreground tabular-nums">{level.hosts_count}</span> host di level ini
                {/* The delete button's reason is only a hover title, which phones never show */}
                {level.hosts_count > 0 && <span className="md:hidden">· belum bisa dihapus</span>}
              </p>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden="true" />
                  Ubah
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setConfirming(true)}
                  disabled={level.hosts_count > 0}
                  title={level.hosts_count > 0 ? "Masih dipakai host" : "Hapus level"}
                  aria-label={`Hapus ${level.name}`}
                  className="text-muted-foreground hover:text-destructive max-md:size-10"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="px-4 pb-3">
            <FieldError>{error}</FieldError>
          </div>
        )}
      </div>

      {confirming && (
        <ConfirmDialog title={`Hapus level "${level.name}"?`} confirmLabel="Hapus level" onConfirm={remove} onClose={() => setConfirming(false)}>
          Level ini tidak dipakai host mana pun, jadi aman dihapus.
        </ConfirmDialog>
      )}
    </Step>
  );
}

/** Add a level, or change one: name, from which month of tenure, and the rate per hour. */
function LevelForm({ level, onDone, onCancel }: { level?: Level; onDone: () => void; onCancel: () => void }) {
  const { token } = useAuth();
  const id = level?.id ?? "new";
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) => {
      const input: RateCategoryInput = {
        name: formValue(data, "name"),
        min_tenure_months: Number(formValue(data, "min_tenure_months")),
        rate_per_hour: Number(formValue(data, "rate_per_hour")),
      };
      return level ? adminHostsApi.updateRateCategory(token, level.id, input) : adminHostsApi.createRateCategory(token, input);
    },
    () => {
      notify({ text: level ? `Level ${level.name} disimpan` : "Level baru ditambahkan" });
      onDone();
    }
  );

  return (
    <form onSubmit={handleSubmit} noValidate className={cn("space-y-3", !level && "rounded-xl border border-dashed border-input bg-card p-4")}>
      {!level && <p className="text-sm font-semibold text-foreground">Level baru</p>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_11rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`level-name-${id}`}>Nama</Label>
          <input id={`level-name-${id}`} name="name" defaultValue={level?.name} placeholder="mis. Di atas 2 tahun" autoFocus className={inputClass} />
          <FieldError>{errors.name}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`level-months-${id}`}>Mulai bulan ke-</Label>
          <input
            id={`level-months-${id}`}
            name="min_tenure_months"
            type="number"
            min={0}
            defaultValue={level?.min_tenure_months}
            className={cn(inputClass, "tabular-nums")}
          />
          <FieldError>{errors.min_tenure_months}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`level-rate-${id}`}>Tarif per jam</Label>
          <RupiahInput id={`level-rate-${id}`} name="rate_per_hour" defaultValue={level?.rate_per_hour} placeholder="0" />
          <FieldError>{errors.rate_per_hour}</FieldError>
        </div>
      </div>
      {error && <FieldError>{error}</FieldError>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Menyimpan…" : level ? "Simpan" : "Tambah level"}
        </Button>
      </div>
    </form>
  );
}

/** How the hosts spread over the levels. */
function Spread({ levels }: { levels: Level[] }) {
  const total = levels.reduce((sum, level) => sum + level.hosts_count, 0);

  return (
    <Card title="Sebaran host" description={`${total} host aktif dan nonaktif yang punya level.`}>
      {total > 0 && (
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
          {levels.map(
            (level, index) =>
              level.hosts_count > 0 && (
                <div key={level.id} className={fillOf(index)} style={{ flexGrow: level.hosts_count }} title={`${level.name}: ${level.hosts_count}`} />
              )
          )}
        </div>
      )}
      <ul className="mt-3 space-y-2">
        {levels.map((level, index) => (
          <li key={level.id} className="flex items-center gap-2.5 text-sm">
            <span className={cn("size-2.5 shrink-0 rounded-full", fillOf(index))} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-body">{level.name}</span>
            <span className="font-medium text-foreground tabular-nums">{level.hosts_count}</span>
            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{total > 0 ? Math.round((level.hosts_count / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Hosts whose rate goes up soon (worth knowing for payroll). */
function Upcoming({ promotions, days }: { promotions: RatePromotion[]; days: number }) {
  return (
    <Card title="Naik level" description={`Dalam ${days} hari ke depan, otomatis di malam harinya.`}>
      {promotions.length === 0 ? (
        <EmptyState
          compact
          icon={CalendarClock}
          title="Belum ada yang naik level"
          description={`Tidak ada host yang mencapai level berikutnya dalam ${days} hari.`}
        />
      ) : (
        <ul className="-mx-1 max-h-80 divide-y divide-border overflow-y-auto">
          {promotions.map((promotion) => (
            <li key={promotion.host_id}>
              <Link
                href={`/admin/hosts/${promotion.host_id}`}
                className="flex items-center gap-3 rounded-lg px-1 py-2.5 outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
              >
                <UserAvatar user={promotion} size="size-8 text-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{promotion.name}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {promotion.from?.name ?? "Tanpa level"}
                    <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
                    {promotion.to.name}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium text-foreground tabular-nums">{formatShortDate(promotion.on)}</p>
                  {promotion.from && (
                    <p className="text-[11px] font-medium text-success tabular-nums">
                      +{formatRupiah(Number(promotion.to.rate_per_hour) - Number(promotion.from.rate_per_hour))}/jam
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Hosts placed by hand: tenure doesn't move them. */
function Pinned({ hosts }: { hosts: PinnedRateHost[] }) {
  return (
    <Card title="Diatur manual" description="Masa kerja tidak mengubah level host ini. Ubah di halaman Host.">
      {hosts.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Hand className="size-4 shrink-0" aria-hidden="true" />
          Semua host mengikuti masa kerja.
        </p>
      ) : (
        <ul className="-mx-1 max-h-64 divide-y divide-border overflow-y-auto">
          {hosts.map((host) => (
            <li key={host.host_id}>
              <Link
                href={`/admin/hosts/${host.host_id}`}
                className="flex items-center gap-3 rounded-lg px-1 py-2 outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
              >
                <UserAvatar user={host} size="size-7 text-[11px]" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{host.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{host.level?.name ?? "Tanpa level"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
