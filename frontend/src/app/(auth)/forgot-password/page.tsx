import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthCard subtitle="Atur ulang kata sandi">
      <ForgotPasswordForm />

      <p className="text-center text-sm">
        <Link href="/login" className="text-purple-300 hover:text-white">
          Kembali ke halaman masuk
        </Link>
      </p>
    </AuthCard>
  );
}
