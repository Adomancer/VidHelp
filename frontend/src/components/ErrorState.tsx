"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A failed load, with a retry. */
export default function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={cn("flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive", className)}
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="text-foreground">
          <RefreshCw aria-hidden="true" />
          Coba lagi
        </Button>
      )}
    </div>
  );
}
