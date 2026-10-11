"use client";

import { useState } from "react";
import { Link2, Send, Unlink } from "lucide-react";
import { discordApi, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";
import StatusBadge from "./StatusBadge";
import { notify } from "./Toast";

export const DISCORD_STATE_KEY = "vidhelp_discord_state";

/**
 * Link a Discord account so the bot can send direct messages (backup picks, SPs, salary slips, …).
 */
export default function DiscordConnect({ id }: { id?: string }) {
  const { token } = useAuth();
  const status = useApiData("discord-status", () => discordApi.status(token));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ message: string }>) {
    setBusy(true);
    setError(null);
    try {
      notify({ text: (await action()).message });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
    status.reload();
  }

  async function connect() {
    setBusy(true);
    try {
      const state = crypto.randomUUID();
      sessionStorage.setItem(DISCORD_STATE_KEY, state);
      window.location.assign((await discordApi.connectUrl(token, state)).url);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  if (!status.data || !status.data.available) return null;
  const link = status.data.link;

  return (
    <Card
      id={id}
      title="Discord"
      description="Dapatkan pesan langsung dari bot VidHelp saat kamu dipilih jadi backup, mendapat SP, atau slip gaji sudah siap."
      action={link ? <StatusBadge tone="success" dot>Terhubung</StatusBadge> : undefined}
    >
      {error && <FormAlert tone="error">{error}</FormAlert>}

      {link ? (
        <div className="space-y-4">
          <p className="text-sm text-body">
            Terhubung sebagai <span className="font-medium text-foreground">{link.discord_username}</span>
            <span className="text-muted-foreground"> sejak {formatDate(link.linked_at)}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => run(() => discordApi.test(token))}>
              <Send aria-hidden="true" />
              Kirim pesan percobaan
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => discordApi.unlink(token))}>
              <Unlink aria-hidden="true" />
              Putuskan
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tidak menerima pesan? Gabung ke server Discord agensi dan aktifkan &quot;Allow direct messages from server members&quot; di
            Privacy Settings server tersebut.
          </p>
        </div>
      ) : (
        <Button type="button" size="lg" disabled={busy} onClick={connect} className="w-full sm:w-auto">
          <Link2 aria-hidden="true" />
          Hubungkan Discord
        </Button>
      )}
    </Card>
  );
}
