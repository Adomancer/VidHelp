import { cn } from "@/lib/utils";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-secondary text-body",
  brand: "bg-primary/10 text-brand",
  success: "bg-success/10 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

/** Text color only, for dots, icons and numbers that follow a status. */
export const toneText: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

/** Solid fill, for bars and dots. */
export const toneFill: Record<Tone, string> = {
  neutral: "bg-faint",
  brand: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
};

interface StatusBadgeProps {
  tone?: Tone;
  /** A small dot before the label. */
  dot?: boolean;
  /** Pulsing dot, for something happening right now. */
  pulse?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

/** The one status pill used everywhere (session, report, backup, payroll, user, SP…). */
export default function StatusBadge({ tone = "neutral", dot = false, pulse = false, className, title, children }: StatusBadgeProps) {
  return (
    <span
      title={title}
      className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap", toneClasses[tone], className)}
    >
      {(dot || pulse) && (
        <span className="relative flex size-1.5" aria-hidden="true">
          {pulse && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
