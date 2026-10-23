/** The form column of every page in the (auth) route group: a title, a line under it, then the form. */
export default function AuthCard({ title, subtitle, children }: { title?: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm animate-in space-y-7 duration-300 fade-in-0 slide-in-from-bottom-2">
      <div className="space-y-5">
        {/* The laptop layout shows the logo in the brand panel */}
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-xs lg:hidden">
          V
        </span>
        {(title || subtitle) && (
          <div className="space-y-1.5">
            {title && <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>}
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
