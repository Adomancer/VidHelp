const tones = {
  error: "bg-red-500/10 border-red-400/40 text-red-200",
  success: "bg-green-500/10 border-green-400/40 text-green-200",
  warning: "bg-yellow-500/10 border-yellow-400/40 text-yellow-100",
};

export default function FormAlert({ tone, children }: { tone: keyof typeof tones; children: React.ReactNode }) {
  return <div role="status" className={`px-4 py-3 rounded-xl border text-sm ${tones[tone]}`}>{children}</div>;
}
