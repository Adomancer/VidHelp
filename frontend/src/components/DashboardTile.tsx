import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** One cell of a dashboard grid; `className` sets its span. */
export default function DashboardTile({
  title,
  link,
  aside,
  className = "",
  children,
}: {
  title: string;
  link?: { href: string; label: string };
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-card p-4 shadow-xs xl:min-h-0 dark:shadow-none", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          {aside}
        </div>
        {link && (
          <Link
            href={link.href}
            className="group inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {link.label}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * A list that scrolls inside its tile: on laptops it takes the tile's remaining height,
 * on smaller screens (tiles stacked) it stops at a fixed height. Focusable so the keyboard can scroll it.
 */
export function TileScroll({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    // The frame takes `className` (margins, border): the fade mask on the scroller would fade a border too
    <div className={cn("flex max-h-96 min-h-0 flex-col overflow-hidden xl:max-h-none xl:flex-1", className)}>
      {/* No scrollbar; the top or bottom edge fades while there's more to scroll to (shadcn scroll-fade) */}
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="no-scrollbar min-h-0 flex-1 scroll-fade overflow-y-auto overscroll-contain outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {children}
      </div>
    </div>
  );
}
