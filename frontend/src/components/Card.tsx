import { cn } from "@/lib/utils";

interface CardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons or a link at the right of the title. */
  action?: React.ReactNode;
  className?: string;
  /** Classes for the body under the title. */
  bodyClassName?: string;
  id?: string;
  children: React.ReactNode;
}

/** A section panel: optional title row (with an action on the right) and the content below. */
export default function Card({ title, description, action, className, bodyClassName, id, children }: CardProps) {
  const hasHeader = Boolean(title || action);

  return (
    <section id={id} className={cn("relative rounded-xl border border-border bg-card text-card-foreground shadow-xs dark:shadow-none", className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 px-5 pt-5 md:px-6">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cn("space-y-4 p-5 md:px-6", hasHeader && "pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}
