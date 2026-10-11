import { Suspense } from "react";
import AuthCard from "@/components/AuthCard";
import { ListSkeleton } from "@/components/Loading";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Buat kata sandi baru" subtitle="Minimal 8 karakter.">
      {/* useSearchParams needs a Suspense boundary */}
      <Suspense fallback={<ListSkeleton rows={2} />}>
        <ResetPasswordForm />
      </Suspense>
    </AuthCard>
  );
}
