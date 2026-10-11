import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SubmitButtonProps {
  loading: boolean;
  children: React.ReactNode;
  /** Full width by default (forms on phones); pass e.g. "w-auto" to size it to its label. */
  className?: string;
  size?: "default" | "lg";
  variant?: "default" | "danger" | "success";
  disabled?: boolean;
}

/** The form's submit button: shows a spinner and keeps its label while saving. */
export default function SubmitButton({ loading, children, className, size = "lg", variant = "default", disabled }: SubmitButtonProps) {
  return (
    <Button type="submit" size={size} variant={variant} disabled={loading || disabled} aria-busy={loading || undefined} className={cn("w-full", className)}>
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </Button>
  );
}
