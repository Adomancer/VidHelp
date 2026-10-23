"use client";

import { BookOpen, ChevronRight, Crown, Pencil } from "lucide-react";
import { type BrandSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { searchMatch } from "./shared";

/** Marks every occurrence of `query` in `text`. */
export function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-warning/30 px-0.5 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

export function BrandAvatar({ brand, size }: { brand: BrandSummary; size: "card" | "drawer" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-semibold",
        size === "card" ? "size-[46px] text-lg" : "size-[52px] text-xl",
        brand.status === "active" ? "bg-primary/10 text-brand" : "bg-muted text-muted-foreground"
      )}
    >
      {brand.name.charAt(0).toUpperCase()}
    </span>
  );
}

export function BrandPills({ brand }: { brand: BrandSummary }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge tone={brand.status === "active" ? "success" : "neutral"} dot={brand.status === "active"} className="h-5 px-1.5 text-[11px]">
        {brand.status === "active" ? "Aktif" : "Nonaktif"}
      </StatusBadge>
      {brand.is_obs && (
        <StatusBadge tone="info" className="h-5 px-1.5 text-[11px]">
          OBS
        </StatusBadge>
      )}
    </span>
  );
}

export function BrandCard({
  brand,
  query,
  onOpen,
  onEdit,
  onKnowledge,
}: {
  brand: BrandSummary;
  query: string;
  onOpen: () => void;
  onEdit: () => void;
  onKnowledge: () => void;
}) {
  const inactive = brand.status === "inactive";
  const knowledgeOnly = searchMatch(brand, query) === "knowledge";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${brand.name}, ${inactive ? "nonaktif" : "aktif"}. Lihat detail`}
      onClick={onOpen}
      onKeyDown={(key) => {
        if (key.target !== key.currentTarget) return;
        if (key.key === "Enter" || key.key === " ") {
          key.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex h-full cursor-pointer flex-col gap-3 rounded-2xl border border-border p-4 shadow-xs transition duration-200 outline-none hover:border-foreground/20 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:hover:-translate-y-0.5 dark:shadow-none",
        inactive ? "bg-muted/40" : "bg-card"
      )}
    >
      <div className="flex items-start gap-3">
        <BrandAvatar brand={brand} size="card" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate font-semibold text-foreground" title={brand.name}>
            <Highlight text={brand.name} query={query} />
          </p>
          <BrandPills brand={brand} />
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="max-md:size-10"
            onClick={(click) => {
              click.stopPropagation();
              onKnowledge();
            }}
            onKeyDown={(key) => key.stopPropagation()}
            aria-label={`Product knowledge ${brand.name}`}
            title="Product knowledge"
          >
            <BookOpen />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="max-md:size-10"
            onClick={(click) => {
              click.stopPropagation();
              onEdit();
            }}
            onKeyDown={(key) => key.stopPropagation()}
            aria-label={`Edit ${brand.name}`}
            title="Edit brand"
          >
            <Pencil />
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Target / periode</dt>
          <dd className="truncate font-semibold text-foreground tabular-nums">{brand.target_hours_per_period.toLocaleString("id-ID")} jam</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Host aktif</dt>
          <dd className="truncate font-semibold text-foreground tabular-nums">{brand.active_hosts_count} orang</dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-xs text-muted-foreground">Leader</dt>
          <dd className={cn("flex min-w-0 items-center gap-1.5 font-medium", brand.leader ? "text-foreground" : "text-muted-foreground")}>
            <Crown className={cn("size-3.5 shrink-0", brand.leader ? "text-warning" : "text-faint")} aria-hidden="true" />
            <span className="truncate">{brand.leader ? <Highlight text={brand.leader.name} query={query} /> : "Belum ada leader"}</span>
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-0.5 text-sm font-medium text-muted-foreground transition-colors group-hover:text-brand">
          Lihat detail
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </span>
        {knowledgeOnly && (
          <StatusBadge tone="warning" className="h-5 truncate px-1.5 text-[11px]">
            Cocok di product knowledge
          </StatusBadge>
        )}
      </div>
    </div>
  );
}
