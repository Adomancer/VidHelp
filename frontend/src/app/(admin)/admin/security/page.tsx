import PageHeader from "@/components/PageHeader";
import PasswordForm from "@/components/PasswordForm";
import TwoFactorSettings from "@/components/TwoFactorSettings";

export default function AdminSecurityPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Keamanan akun" description="Verifikasi dua langkah dan kata sandi untuk akunmu." />
      <TwoFactorSettings />
      <PasswordForm />
    </div>
  );
}
