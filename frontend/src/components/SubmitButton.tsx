export default function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full px-4 py-3 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-500 disabled:opacity-60 disabled:cursor-wait transition-colors"
    >
      {loading ? "Tunggu sebentar…" : children}
    </button>
  );
}
