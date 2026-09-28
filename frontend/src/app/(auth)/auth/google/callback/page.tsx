import { Suspense } from "react";
import GoogleCallback from "@/components/GoogleCallback";

export default function GoogleCallbackPage() {
  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 shadow-2xl">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">VidHelp</h1>
      </div>

      {/* useSearchParams needs a Suspense boundary */}
      <Suspense fallback={<p className="text-center text-gray-300">Signing you in…</p>}>
        <GoogleCallback />
      </Suspense>
    </div>
  );
}
