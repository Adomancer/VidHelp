import DiscordConnect from "@/components/DiscordConnect";
import PageHeader from "@/components/PageHeader";
import PasswordForm from "@/components/PasswordForm";
import { STAFF_DISCORD_DESCRIPTION } from "@/lib/discord";

export default function OperatorAccountPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Akun" description="Kata sandi dan pesan Discord untuk akunmu." />
      <PasswordForm />
      <DiscordConnect id="discord" description={STAFF_DISCORD_DESCRIPTION} />
    </div>
  );
}
