import { cn } from "@/lib/utils";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-secondary text-body ring-1 ring-inset ring-border",
  brand: "bg-primary/10 text-brand ring-1 ring-inset ring-primary/20",
  success: "bg-success-subtle text-success ring-1 ring-inset ring-success/20",
  warning: "bg-warning-subtle text-warning ring-1 ring-inset ring-warning/20",
  danger: "bg-destructive-subtle text-destructive ring-1 ring-inset ring-destructive/20",
  info: "bg-info-subtle text-info ring-1 ring-inset ring-info/20",
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
          <span className={cn("relative inline-flex size-1.5 rounded-full bg-current", pulse && "ring-2 ring-current/25")} />
        </span>
      )}
      {children}
    </span>
  );
}
