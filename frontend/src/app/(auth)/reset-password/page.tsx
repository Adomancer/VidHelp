import { Suspense } from "react";
import AuthCard from "@/components/AuthCard";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <AuthCard subtitle="Choose a new password">
      {/* useSearchParams needs a Suspense boundary */}
      <Suspense fallback={<p className="text-center text-gray-300">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
