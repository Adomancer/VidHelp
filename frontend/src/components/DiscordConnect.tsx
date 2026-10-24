"use client";

import { useState } from "react";
import { Link2, Send, Unlink } from "lucide-react";
import { discordApi, errorMessage, type DiscordLink, type DiscordStatus } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "./AuthProvider";
import Card from "./Card";
import ErrorState from "./ErrorState";
import FormAlert from "./FormAlert";
import StatusBadge from "./StatusBadge";
import { notify } from "./Toast";

export const DISCORD_STATE_KEY = "vidhelp_discord_state";

/** The page to come back to after Discord's consent page (the callback page reads it). */
export const DISCORD_RETURN_KEY = "vidhelp_discord_return";

const HOST_DESCRIPTION =
  "Dapatkan pesan langsung dari bot VidHelp: pengingat live, backup, slip gaji, poin dan SP, lengkap dengan detail dan tombol untuk membukanya.";

/**
 * Link a Discord account so the bot can send direct messages, and pick which kinds come.
 */
export default function DiscordConnect({ id, description = HOST_DESCRIPTION }: { id?: string; description?: string }) {
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
      const { url, state } = await discordApi.connectUrl(token);
      sessionStorage.setItem(DISCORD_STATE_KEY, state);
      sessionStorage.setItem(DISCORD_RETURN_KEY, `${window.location.pathname}${id ? `#${id}` : ""}`);
      window.location.assign(url);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  if (status.error && !status.data) {
    return (
      <Card id={id} title="Discord" description={description}>
        <ErrorState message={status.error} onRetry={status.reload} />
      </Card>
    );
  }
  if (!status.data || !status.data.available) return null;
  const link = status.data.link;

  return (
    <Card
      id={id}
      title="Discord"
      description={description}
      action={
        link ? (
          <StatusBadge tone={link.dm_blocked || link.in_guild === false ? "warning" : "success"} dot>
            Terhubung
          </StatusBadge>
        ) : undefined
      }
    >
      {error && <FormAlert tone="error">{error}</FormAlert>}

      {link ? (
        <div className="space-y-5">
          <p className="text-sm text-body">
            Terhubung sebagai <span className="font-medium text-foreground">{link.discord_username}</span>
            <span className="text-muted-foreground"> sejak {formatDate(link.linked_at)}</span>
          </p>

          {link.in_guild === false ? (
            <FormAlert tone="warning">
              Kamu belum ada di server Discord agensi, jadi bot tidak bisa mengirim pesan. Putuskan lalu hubungkan lagi supaya otomatis ditambahkan, atau minta
              undangan ke admin.
            </FormAlert>
          ) : (
            link.dm_blocked && (
              <FormAlert tone="warning">
                Discord menolak pesan terakhir untukmu. Di server agensi, buka Privacy Settings dan aktifkan &quot;Direct Messages&quot;, lalu kirim pesan
                percobaan.
              </FormAlert>
            )
          )}

          <Preferences categories={status.data.categories} link={link} onSaved={(saved) => status.setData({ ...status.data!, link: saved })} />

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

/** One switch per category: on = it comes as a DM. Saved on every change. */
function Preferences({ categories, link, onSaved }: { categories: DiscordStatus["categories"]; link: DiscordLink; onSaved: (link: DiscordLink) => void }) {
  const { token } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (categories.length === 0) return null;

  async function toggle(key: string, on: boolean) {
    setSaving(key);
    setError(null);
    try {
      const muted = on ? link.muted.filter((category) => category !== key) : [...link.muted, key];
      onSaved((await discordApi.preferences(token, muted)).link);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(null);
    }
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-foreground">Kirim ke Discord</legend>
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {categories.map((category) => (
          <li key={category.key} className="flex items-center justify-between gap-4 px-3.5 py-2.5">
            <label htmlFor={`discord-${category.key}`} className="text-sm text-body">
              {category.label}
            </label>
            <Switch
              id={`discord-${category.key}`}
              checked={!link.muted.includes(category.key)}
              disabled={saving !== null}
              onCheckedChange={(on) => void toggle(category.key, on)}
            />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Semua notifikasi tetap muncul di lonceng. Persetujuan akun, SP dan slip gaji selalu dikirim ke Discord.</p>
    </fieldset>
  );
}
