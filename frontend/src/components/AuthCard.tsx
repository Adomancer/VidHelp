/** Glass card used by every page in the (auth) route group. */
export default function AuthCard({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md mx-4 p-8 space-y-6 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 shadow-2xl">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">VidHelp</h1>
        {subtitle && <p className="text-sm text-gray-300 mt-2">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
