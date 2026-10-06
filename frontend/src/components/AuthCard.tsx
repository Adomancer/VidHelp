/** Card used by every page in the (auth) route group. */
export default function AuthCard({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md mx-4 p-8 space-y-6 bg-surface rounded-[10px] border border-stroke shadow-card">
      <div className="text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white">V</span>
        <h1 className="text-3xl font-bold text-heading">VidHelp</h1>
        {subtitle && <p className="text-sm text-muted mt-2">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
