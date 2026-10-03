"use client";

import { useState } from "react";
import { discordApi, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import FormAlert from "./FormAlert";

export const DISCORD_STATE_KEY = "vidhelp_discord_state";

/**
 * Link a Discord account so the bot can send direct messages (backup picks, SPs, salary slips, …).
 */
export default function DiscordConnect() {
  const { token } = useAuth();
  const status = useApiData("discord-status", () => discordApi.status(token));
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ message: string }>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ tone: "success", text: (await action()).message });
    } catch (caught) {
      setNotice({ tone: "error", text: errorMessage(caught) });
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
      setNotice({ tone: "error", text: errorMessage(caught) });
      setBusy(false);
    }
  }

  if (!status.data || !status.data.available) return null;
  const link = status.data.link;

  return (
    <Card title="Discord" description="Dapatkan pesan langsung dari bot VidHelp saat kamu dipilih jadi backup, mendapat SP, atau slip gaji sudah siap.">
      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}

      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-200">
            Terhubung sebagai <span className="text-white font-medium">{link.discord_username}</span>
            <span className="text-gray-400"> sejak {formatDate(link.linked_at)}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => discordApi.test(token))}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              Kirim pesan percobaan
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => discordApi.unlink(token))}
              className="px-3 py-2 rounded-lg border border-slate-700 text-gray-300 text-sm hover:bg-slate-800 disabled:opacity-50"
            >
              Putuskan
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Tidak menerima pesan? Gabung ke server Discord agensi dan aktifkan &quot;Allow direct messages from server members&quot; di
            Privacy Settings server tersebut.
          </p>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={connect}
          className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          Hubungkan Discord
        </button>
      )}
    </Card>
  );
}
