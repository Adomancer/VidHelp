import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthCard subtitle="Reset your password">
      <ForgotPasswordForm />

      <p className="text-center text-sm">
        <Link href="/login" className="text-purple-300 hover:text-white">
          Back to login
        </Link>
      </p>
    </AuthCard>
  );
}
