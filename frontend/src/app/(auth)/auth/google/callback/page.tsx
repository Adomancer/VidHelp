import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import AuthCard from "@/components/AuthCard";
import GoogleCallback from "@/components/GoogleCallback";

export default function GoogleCallbackPage() {
  return (
    <AuthCard>
      {/* useSearchParams needs a Suspense boundary */}
      <Suspense
        fallback={
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Sedang masuk…
          </p>
        }
      >
        <GoogleCallback />
      </Suspense>
    </AuthCard>
  );
}
