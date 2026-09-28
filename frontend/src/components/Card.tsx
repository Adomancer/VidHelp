/** Dark panel used for sections on dashboard pages. */
export default function Card({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      {title && (
        <div>
          <h2 className="text-white font-medium">{title}</h2>
          {description && <p className="text-sm text-gray-400 mt-1">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
