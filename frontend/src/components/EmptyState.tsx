import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A button or link to the next step. */
  action?: React.ReactNode;
  className?: string;
  /** Smaller, for inside cards and lists. */
  compact?: boolean;
}

/** An empty list: what it holds, why it's empty, and what to do next. */
export default function EmptyState({ icon: Icon = Inbox, title, description, action, className, compact = false }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12", className)}>
      <span className={cn("flex items-center justify-center rounded-full bg-muted text-muted-foreground", compact ? "size-9" : "size-11")}>
        <Icon className={compact ? "size-4" : "size-5"} aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
