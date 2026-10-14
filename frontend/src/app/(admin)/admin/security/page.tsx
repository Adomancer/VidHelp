import DiscordConnect from "@/components/DiscordConnect";
import PageHeader from "@/components/PageHeader";
import PasswordForm from "@/components/PasswordForm";
import TwoFactorSettings from "@/components/TwoFactorSettings";
import { STAFF_DISCORD_DESCRIPTION } from "@/lib/discord";

export default function AdminSecurityPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Keamanan akun" description="Verifikasi dua langkah, kata sandi, dan pesan Discord untuk akunmu." />
      <TwoFactorSettings />
      <PasswordForm />
      <DiscordConnect id="discord" description={STAFF_DISCORD_DESCRIPTION} />
    </div>
  );
}
