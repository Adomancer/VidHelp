export default function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full px-4 py-3 rounded-lg bg-primary text-white font-medium hover:bg-primary-hover disabled:opacity-60 disabled:cursor-wait transition-colors"
    >
      {loading ? "Tunggu sebentar…" : children}
    </button>
  );
}
