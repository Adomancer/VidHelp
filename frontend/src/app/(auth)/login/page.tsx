import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { GuestOnly } from "@/components/AuthProvider";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <GuestOnly>
      <AuthCard subtitle="Platform Manajemen Agensi">
        <LoginForm />

        <p className="text-center text-sm text-muted">
          Host baru?{" "}
          <Link href="/register" className="text-accent hover:text-heading">
            Buat akun
          </Link>
        </p>
      </AuthCard>
    </GuestOnly>
  );
}
