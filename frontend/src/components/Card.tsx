/** White (dark: navy) panel used for sections on dashboard pages. */
export default function Card({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-stroke rounded-[10px] shadow-card p-5 md:p-6 space-y-4">
      {title && (
        <div>
          <h2 className="text-lg font-semibold text-heading">{title}</h2>
          {description && <p className="text-sm text-muted mt-1">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
