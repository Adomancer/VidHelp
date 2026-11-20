import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
  error: { className: "border-destructive/25 bg-destructive-subtle text-destructive", icon: CircleAlert },
  success: { className: "border-success/25 bg-success-subtle text-success", icon: CircleCheck },
  warning: { className: "border-warning/25 bg-warning-subtle text-warning", icon: TriangleAlert },
  info: { className: "border-info/25 bg-info-subtle text-info", icon: Info },
};

/** An inline message inside a page or form: errors next to what failed, warnings before an action. */
export default function FormAlert({ tone, className, children }: { tone: keyof typeof tones; className?: string; children: React.ReactNode }) {
  const { className: toneClass, icon: Icon } = tones[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm", toneClass, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2">{children}</div>
    </div>
  );
}
