import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { GuestOnly } from "@/components/AuthProvider";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <GuestOnly>
      <AuthCard title="Masuk ke VidHelp" subtitle="Selamat datang kembali. Masuk untuk melanjutkan.">
        <LoginForm />

        <p className="text-center text-sm text-muted-foreground">
          Host baru?{" "}
          <Link href="/register" className="font-medium text-brand hover:underline">
            Buat akun
          </Link>
        </p>
      </AuthCard>
    </GuestOnly>
  );
}
