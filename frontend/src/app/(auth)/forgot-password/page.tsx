import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import AuthCard from "@/components/AuthCard";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Lupa kata sandi?"
      subtitle="Masukkan email kamu, nanti kami kirim link untuk membuat kata sandi baru ke email itu, dan ke DM Discord kalau akunmu sudah terhubung. Bisa juga dipakai kalau kamu daftar lewat Google dan belum punya kata sandi."
    >
      <ForgotPasswordForm />

      <p className="text-center text-sm">
        <Link href="/login" className="inline-flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Kembali ke halaman masuk
        </Link>
      </p>
    </AuthCard>
  );
}
