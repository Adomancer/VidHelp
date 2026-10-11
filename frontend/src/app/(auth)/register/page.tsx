import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { GuestOnly } from "@/components/AuthProvider";
import RegisterForm from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <GuestOnly>
      <AuthCard title="Buat akun host" subtitle="Akun baru diperiksa admin dulu sebelum kamu bisa masuk.">
        <RegisterForm />

        <p className="text-center text-sm text-muted-foreground">
          Sudah punya akun?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Masuk
          </Link>
        </p>
      </AuthCard>
    </GuestOnly>
  );
}
