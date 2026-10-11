import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons on the right (they wrap under the title on phones). */
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}

/** Title row at the top of every page. */
export default function PageHeader({ title, description, actions, back, className }: PageHeaderProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none print:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <div className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
      </div>
    </div>
  );
}
