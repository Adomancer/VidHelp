import PasswordForm from "@/components/PasswordForm";
import TwoFactorSettings from "@/components/TwoFactorSettings";

export default function AdminSecurityPage() {
  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-white">Security</h1>
      <TwoFactorSettings />
      <PasswordForm />
    </div>
  );
}
