"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TruncatedCellProps {
  text: string | null | undefined;
  fallback?: string;
  maxLines?: 1 | 2;
  className?: string;
}

/** Truncated table text that reveals its full value in a tooltip on hover or keyboard focus. */
export default function TruncatedCell({ text, fallback = "–", maxLines = 1, className }: TruncatedCellProps) {
  if (!text) {
    return <span className="text-muted-foreground">{fallback}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            maxLines === 2 ? "line-clamp-2" : "block truncate",
            className
          )}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm break-words">{text}</TooltipContent>
    </Tooltip>
  );
}
