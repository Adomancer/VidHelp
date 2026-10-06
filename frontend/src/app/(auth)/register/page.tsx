import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { GuestOnly } from "@/components/AuthProvider";
import RegisterForm from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <GuestOnly>
      <AuthCard subtitle="Buat akun kamu">
        <RegisterForm />

        <p className="text-center text-xs text-muted">
          Akun baru diperiksa admin dulu sebelum kamu bisa masuk.
        </p>
        <p className="text-center text-sm text-muted">
          Sudah punya akun?{" "}
          <Link href="/login" className="text-accent hover:text-heading">
            Masuk
          </Link>
        </p>
      </AuthCard>
    </GuestOnly>
  );
}
