import { Suspense } from "react";
import AuthCard from "@/components/AuthCard";
import GoogleCallback from "@/components/GoogleCallback";

export default function GoogleCallbackPage() {
  return (
    <AuthCard>
      {/* useSearchParams needs a Suspense boundary */}
      <Suspense fallback={<p className="text-center text-gray-300">Signing you in…</p>}>
        <GoogleCallback />
      </Suspense>
    </AuthCard>
  );
}
