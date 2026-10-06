const tones = {
  error: "bg-red-500/10 border-red-500/30 text-danger",
  success: "bg-green-500/10 border-green-500/30 text-success",
  warning: "bg-yellow-500/10 border-yellow-500/40 text-warning",
};

export default function FormAlert({ tone, children }: { tone: keyof typeof tones; children: React.ReactNode }) {
  return <div role="status" className={`px-4 py-3 rounded-lg border text-sm ${tones[tone]}`}>{children}</div>;
}
