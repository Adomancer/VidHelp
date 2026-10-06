import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { GuestOnly } from "@/components/AuthProvider";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <GuestOnly>
      <AuthCard subtitle="Platform Manajemen Agensi">
        <LoginForm />

        <p className="text-center text-sm text-gray-400">
          Host baru?{" "}
          <Link href="/register" className="text-purple-300 hover:text-white">
            Buat akun
          </Link>
        </p>
      </AuthCard>
    </GuestOnly>
  );
}
