import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthCard subtitle="Atur ulang kata sandi">
      <ForgotPasswordForm />

      <p className="text-center text-sm">
        <Link href="/login" className="text-accent hover:text-heading">
          Kembali ke halaman masuk
        </Link>
      </p>
    </AuthCard>
  );
}
