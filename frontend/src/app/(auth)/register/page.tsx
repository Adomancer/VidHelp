import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { GuestOnly } from "@/components/AuthProvider";
import RegisterForm from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <GuestOnly>
      <AuthCard subtitle="Buat akun kamu">
        <RegisterForm />

        <p className="text-center text-xs text-gray-400">
          Akun baru diperiksa admin dulu sebelum kamu bisa masuk.
        </p>
        <p className="text-center text-sm text-gray-400">
          Sudah punya akun?{" "}
          <Link href="/login" className="text-purple-300 hover:text-white">
            Masuk
          </Link>
        </p>
      </AuthCard>
    </GuestOnly>
  );
}
