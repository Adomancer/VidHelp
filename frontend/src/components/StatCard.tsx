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
  className?: string;
}

/** A headline number with its label, an icon and a line of context. */
export default function StatCard({ icon: Icon, label, value, note, tone = "neutral", href, className }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconTones[tone])}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</div>
      {note && <div className="mt-auto line-clamp-2 pt-1.5 text-xs text-muted-foreground">{note}</div>}
    </>
  );

  const classes = cn("flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 shadow-xs dark:shadow-none", className);

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

  return <section className={classes}>{body}</section>;
}
