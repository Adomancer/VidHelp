import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "./StatusBadge";

const iconTones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-primary/10 text-brand",
  success: "bg-success/10 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  /** Context under the number. */
  note?: React.ReactNode;
  tone?: Tone;
  /** The whole card opens this page. */
  href?: string;
  /** The whole card is a filter button instead; `selected` while its filter is on. */
  onClick?: () => void;
  selected?: boolean;
  /** Tighter padding and a smaller number, for a strip of many cards. */
  compact?: boolean;
  className?: string;
}

/** A headline number with its label, an icon and a line of context. */
export default function StatCard({
  icon: Icon,
  label,
  value,
  note,
  tone = "neutral",
  href,
  onClick,
  selected = false,
  compact = false,
  className,
}: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className={cn("text-muted-foreground", compact ? "truncate text-xs" : "text-sm")}>{label}</p>
        <span className={cn("flex shrink-0 items-center justify-center rounded-lg", compact ? "size-7" : "size-8", iconTones[tone])}>
          <Icon className={compact ? "size-3.5" : "size-4"} aria-hidden="true" />
        </span>
      </div>
      <div className={cn("truncate font-semibold tracking-tight text-foreground tabular-nums", compact ? "-mt-1 text-xl" : "mt-1.5 text-2xl")}>{value}</div>
      {note && <div className={cn("mt-auto text-xs text-muted-foreground", compact ? "truncate pt-1" : "line-clamp-2 pt-1.5")}>{note}</div>}
    </>
  );

  const classes = cn("flex min-w-0 flex-col rounded-xl border border-border bg-card shadow-xs dark:shadow-none", compact ? "px-4 py-3" : "p-5", className);

  if (href) {
    return (
      <Link
        href={href}
        className={cn(classes, "transition-colors outline-none hover:border-input hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50")}
      >
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          classes,
          "text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          selected ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/20" : "hover:border-input hover:bg-muted/30"
        )}
      >
        {body}
      </button>
    );
  }

  return <section className={classes}>{body}</section>;
}
