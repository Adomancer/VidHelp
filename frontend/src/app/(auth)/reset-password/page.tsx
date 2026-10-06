import { Suspense } from "react";
import AuthCard from "@/components/AuthCard";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <AuthCard subtitle="Buat kata sandi baru">
      {/* useSearchParams needs a Suspense boundary */}
      <Suspense fallback={<p className="text-center text-body">Memuat…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
