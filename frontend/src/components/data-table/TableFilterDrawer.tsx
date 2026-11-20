"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface TableFilterDrawerProps {
  activeCount?: number;
  onReset?: () => void;
  title?: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

/** Mobile bottom-sheet filter drawer with an active-filter counter badge on its trigger. */
export default function TableFilterDrawer({ activeCount = 0, onReset, title = "Filter", description, className, children }: TableFilterDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className={cn("gap-2", className)}>
        <SlidersHorizontal aria-hidden="true" />
        <span>Filter</span>
        {activeCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-brand tabular-nums">
            {activeCount}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
          <SheetHeader className="border-b border-border px-5 pt-3 pb-4">
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>

          <SheetFooter className="flex-row items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3.5">
            {activeCount > 0 && onReset && (
              <Button type="button" variant="ghost" onClick={onReset} className="mr-auto text-muted-foreground">
                Reset filter
              </Button>
            )}
            <Button type="button" onClick={() => setOpen(false)}>
              Terapkan
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
