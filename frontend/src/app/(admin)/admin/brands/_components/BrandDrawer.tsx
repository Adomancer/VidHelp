"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, Copy, Crown, Pencil } from "lucide-react";
import { scheduleApi, type BrandSummary } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { htmlToText, richTextClass } from "@/lib/richText";
import { useApiData } from "@/lib/useApiData";
import { cn } from "@/lib/utils";
import Dialog from "@/components/Dialog";
import StatusBadge from "@/components/StatusBadge";
import { notifyCapsule } from "@/components/Toast";
import { useAuth } from "@/components/AuthProvider";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { BrandAvatar, BrandPills, Highlight } from "./BrandCard";
import { payrollState, TOAST_MS } from "./shared";

export function BrandDrawer({
  brand,
  query,
  onClose,
  onEdit,
  onKnowledge,
}: {
  brand: BrandSummary;
  query: string;
  onClose: () => void;
  onEdit: () => void;
  onKnowledge: () => void;
}) {
  const days = Math.round((brand.target_hours_per_period / 24) * 10) / 10;

  async function copy() {
    try {
      await navigator.clipboard.writeText(htmlToText(brand.product_knowledge ?? ""));
      notifyCapsule("Product knowledge disalin", "success", TOAST_MS);
    } catch {
      notifyCapsule("Gagal menyalin, coba lagi", "error", TOAST_MS);
    }
  }

  return (
    <Dialog
      placement="side"
      size="md"
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <BrandAvatar brand={brand} size="drawer" />
          <span className="min-w-0 space-y-1">
            <span className="block truncate text-lg">{brand.name}</span>
            <BrandPills brand={brand} />
          </span>
        </span>
      }
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            Tutup
          </Button>
          <Button type="button" size="lg" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Edit brand
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Ringkasan</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Target / periode</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{brand.target_hours_per_period.toLocaleString("id-ID")} jam</p>
              <p className="text-xs text-muted-foreground tabular-nums">≈ {days.toLocaleString("id-ID")} hari</p>
            </div>
            <div className="rounded-xl border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Host aktif</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{brand.active_hosts_count} orang</p>
              <p className="text-xs text-muted-foreground">{brand.active_hosts_count > 0 ? "ditugaskan di halaman Host" : "belum ada host"}</p>
            </div>
            <div className="col-span-2 rounded-xl border border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">Mulai penggajian</p>
              <p className="text-lg font-semibold text-foreground tabular-nums">{brand.payroll_start_date ? formatDate(brand.payroll_start_date) : "—"}</p>
              <p className="text-xs text-muted-foreground">{payrollState(brand.payroll_start_date)}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Leader</h3>
          <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                brand.leader ? "bg-warning/12 text-warning" : "bg-muted text-faint"
              )}
            >
              <Crown className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate font-medium", brand.leader ? "text-foreground" : "text-muted-foreground")}>
                {brand.leader ? <Highlight text={brand.leader.name} query={query} /> : "Belum ada leader"}
              </span>
              <span className="block text-xs text-muted-foreground">{brand.leader ? "Penanggung jawab brand" : "Tunjuk leader dari halaman Host"}</span>
            </span>
          </div>
        </section>

        <BrandHosts brand={brand} />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Informasi</h3>
          <dl className="divide-y divide-border rounded-xl border border-border text-sm">
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium text-foreground">{brand.status === "active" ? "Aktif" : "Nonaktif"}</dd>
            </div>
            <div className="flex justify-between gap-3 px-4 py-2.5">
              <dt className="text-muted-foreground">Brand OBS</dt>
              <dd className="font-medium text-foreground">{brand.is_obs ? "Ya" : "Tidak"}</dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Product knowledge</h3>
            <div className="flex gap-2">
              {brand.product_knowledge && (
                <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                  <Copy aria-hidden="true" />
                  Salin
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={onKnowledge}>
                <BookOpen aria-hidden="true" />
                Kelola
              </Button>
            </div>
          </div>
          {brand.product_knowledge ? (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              {/* Safe HTML: the API keeps only formatting tags */}
              <div className={richTextClass} dangerouslySetInnerHTML={{ __html: brand.product_knowledge }} />
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground italic">
              Belum ada product knowledge. Tambahkan lewat &ldquo;Kelola&rdquo; supaya host bisa membacanya.
            </p>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/** The hosts on the brand, folded away until opened (and only then loaded). */
function BrandHosts({ brand }: { brand: BrandSummary }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const hosts = useApiData(`brand-hosts-${brand.id}`, () => scheduleApi.brandHosts(token, brand.id), { enabled: open });
  const list = [...(hosts.data?.assignments ?? [])]
    .filter((assignment) => assignment.status === "active")
    .sort((a, b) => Number(b.is_leader) - Number(a.is_leader) || a.host.user.name.localeCompare(b.host.user.name, "id"));
  const count = brand.active_hosts_count;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Host terdaftar</h3>
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Belum ada host di brand ini. Tugaskan host dari halaman Host.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={`brand-hosts-${brand.id}`}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
          >
            <span>
              {count} host aktif
              <span className="ml-1.5 font-normal text-muted-foreground">{open ? "· sembunyikan" : "· lihat daftar"}</span>
            </span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
          </button>
          {open && (
            <div id={`brand-hosts-${brand.id}`} className="border-t border-border">
              {hosts.error ? (
                <p className="px-4 py-3 text-sm text-destructive">{hosts.error}</p>
              ) : !hosts.data ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Memuat host…</p>
              ) : (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                  {list.map((assignment) => (
                    <li key={assignment.id} className="flex items-center gap-3 px-4 py-2.5">
                      <UserAvatar user={assignment.host.user} size="size-8 text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{assignment.host.user.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{assignment.host.user.email}</span>
                      </span>
                      {assignment.is_leader && (
                        <StatusBadge tone="warning" className="h-5 shrink-0 gap-1 px-1.5 text-[11px]">
                          <Crown className="size-3" aria-hidden="true" />
                          Leader
                        </StatusBadge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
