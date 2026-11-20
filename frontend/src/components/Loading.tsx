import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Placeholder rows while a list loads. */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-4", className)} aria-busy="true" aria-label="Memuat">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder cards while a page loads. */
export function CardsSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4", className)} aria-busy="true" aria-label="Memuat">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3 rounded-xl border border-border bg-card p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder table rows while they load. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  density = "comfortable",
  mobileCards = false,
}: {
  rows?: number;
  columns?: number;
  density?: "comfortable" | "compact";
  mobileCards?: boolean;
}) {
  const rowPadding = density === "compact" ? "py-2" : "py-3.5";

  return (
    <div aria-busy="true" aria-label="Memuat">
      <div className={cn("divide-y divide-border", mobileCards && "hidden md:block")}>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className={cn("flex items-center gap-4 px-4", rowPadding)}>
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton key={column} className={cn("h-3.5", column === 0 ? "w-1/4" : "flex-1")} />
            ))}
          </div>
        ))}
      </div>
      {mobileCards && (
        <div className="divide-y divide-border md:hidden">
          {Array.from({ length: Math.min(rows, 4) }, (_, row) => (
            <div key={row} className="space-y-2.5 p-4">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-5 w-16 rounded-md" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A thin bar sliding along the top of a block that is reloading data it already shows. Put it in a `relative` parent. */
export function RefreshBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" aria-hidden="true">
      <div className="h-full w-1/3 animate-[refresh-bar_1s_ease-in-out_infinite] bg-primary/70" />
    </div>
  );
}
