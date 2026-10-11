import { cn } from "@/lib/utils";

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** A small toggle button for picking from a short list (dates, reasons, days). */
export default function Chip({ selected = false, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:h-8",
        selected ? "border-primary bg-primary/10 font-medium text-brand" : "border-input text-body hover:bg-muted",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
