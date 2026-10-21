"use client";

import { useRef, useState } from "react";
import { CircleCheck, CircleX, Clock, MessageSquareOff, RotateCw, Send, Square, Users } from "lucide-react";
import { parseAsInteger, parseAsStringLiteral, useQueryStates } from "nuqs";
import {
  errorMessage,
  notificationAdminApi,
  type DeliveryStatus,
  type DiscordCheck,
  type DiscordSetup,
  type NotificationDelivery,
  type PreviewTarget,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import FormAlert from "@/components/FormAlert";
import { CardsSkeleton, RefreshBar, TableSkeleton } from "@/components/Loading";
import PageHeader from "@/components/PageHeader";
import Pagination from "@/components/Pagination";
import { NativeSelect } from "@/components/SelectField";
import StatCard from "@/components/StatCard";
import StatusBadge, { type Tone } from "@/components/StatusBadge";
import { notify } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const statuses = ["sent", "pending", "failed", "skipped"] as const;
const channels = ["discord_channel", "discord_dm"] as const;

const statusLabels: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  sent: { label: "Terkirim", tone: "success" },
  pending: { label: "Menunggu", tone: "info" },
  failed: { label: "Gagal", tone: "danger" },
  skipped: { label: "Dilewati", tone: "neutral" },
};

/** Filters and page live in the URL, so a refresh shows the same list. */
const urlState = {
  status: parseAsStringLiteral(statuses),
  channel: parseAsStringLiteral(channels),
  page: parseAsInteger.withDefault(1),
};

export default function NotificationsPage() {
  const { token } = useAuth();
  const setup = useApiData("discord-setup", () => notificationAdminApi.setup(token));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifikasi Discord"
        description="Cek apakah bot, server dan channel sudah siap, siapa yang sudah menghubungkan Discord, dan status setiap pesan yang dikirim bot."
      />

      {setup.error && <ErrorState message={setup.error} onRetry={setup.reload} />}
      {!setup.data && !setup.error && <CardsSkeleton count={3} />}
      {setup.data && <Setup setup={setup.data} onChecked={setup.reload} checking={setup.loading} />}

      <Deliveries onChanged={setup.reload} />
    </div>
  );
}

function Setup({ setup, onChecked, checking }: { setup: DiscordSetup; onChecked: () => void; checking: boolean }) {
  const { token } = useAuth();
  const [testing, setTesting] = useState<string | null>(null);

  async function test(channel: "backups" | "admin") {
    setTesting(channel);
    try {
      notify({ text: (await notificationAdminApi.testChannel(token, channel)).message });
    } catch (caught) {
      notify({ text: errorMessage(caught), tone: "error" });
    } finally {
      setTesting(null);
    }
  }

  const { last_24h: last, linked } = setup;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CircleCheck} label="Terkirim (24 jam)" value={last.sent} tone="success" />
        <StatCard
          icon={CircleX}
          label="Gagal (24 jam)"
          value={last.failed}
          tone={last.failed > 0 ? "danger" : "neutral"}
          note={last.pending > 0 ? `${last.pending} masih menunggu` : undefined}
        />
        <StatCard
          icon={Users}
          label="Host terhubung"
          value={`${linked.hosts}/${linked.hosts_total}`}
          tone="brand"
          note={`Staff ${linked.staff}/${linked.staff_total}`}
        />
        <StatCard
          icon={MessageSquareOff}
          label="DM ditolak Discord"
          value={linked.dm_blocked}
          tone={linked.dm_blocked > 0 ? "warning" : "neutral"}
          note="DM tertutup atau belum di server"
        />
      </div>

      <Card
        title="Pengaturan bot"
        description="Diatur di file .env backend. Status diperiksa langsung ke Discord."
        action={
          <Button type="button" variant="outline" size="sm" disabled={checking} onClick={onChecked}>
            <RotateCw aria-hidden="true" className={checking ? "animate-spin" : undefined} />
            Periksa lagi
          </Button>
        }
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          <SetupRow
            label="Bot"
            env="DISCORD_BOT_TOKEN"
            check={{ set: setup.bot.configured, ok: setup.bot.configured ? true : null, error: null }}
            detail={setup.bot.configured ? "Token terpasang" : "Tanpa token, notifikasi hanya muncul di lonceng"}
          />
          <SetupRow
            label="Hubungkan Discord"
            env="DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET"
            check={{ set: setup.bot.can_connect, ok: setup.bot.can_connect ? true : null, error: null }}
            detail={setup.bot.can_connect ? "Pengguna bisa menghubungkan akun" : "Tombol Hubungkan Discord disembunyikan"}
          />
          <SetupRow
            label="Server agensi"
            env="DISCORD_GUILD_ID"
            check={setup.guild}
            detail={
              setup.guild.ok
                ? `${setup.guild.name}${setup.guild.members ? ` · ${setup.guild.members} anggota` : ""} · pengguna otomatis ditambahkan saat menghubungkan`
                : "Tanpa server, pengguna harus bergabung sendiri supaya bisa menerima DM"
            }
          />
          {setup.channels.map((channel) => (
            <SetupRow
              key={channel.key}
              label={channel.label}
              env={channel.key === "admin" ? "DISCORD_CHANNEL_ADMIN" : "DISCORD_CHANNEL_BACKUPS"}
              check={channel}
              detail={
                channel.ok
                  ? `${channel.name ?? "Channel"}${channel.key === "admin" ? (channel.role_ping ? " · role admin di-ping" : " · tanpa ping role (DISCORD_ROLE_ADMIN)") : " · host terkait di-ping"}`
                  : undefined
              }
              action={
                channel.ok && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="max-md:h-10 max-md:px-3"
                    disabled={testing !== null}
                    onClick={() => void test(channel.key)}
                  >
                    <Send aria-hidden="true" />
                    {testing === channel.key ? "Mengirim…" : "Kirim tes"}
                  </Button>
                )
              }
            />
          ))}
        </ul>
      </Card>

      {setup.bot.configured && <Examples setup={setup} />}
    </div>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Post an example of every notification type, one request each (Discord allows about
 * 5 messages per 5 seconds in a channel), with progress and a stop button.
 */
function Examples({ setup }: { setup: DiscordSetup }) {
  const { token } = useAuth();
  const ready = setup.channels.filter((channel) => channel.ok);
  const [to, setTo] = useState<PreviewTarget>(ready[0]?.key ?? "me");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<{ type: string; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stop = useRef(false);

  function requestStop() {
    stop.current = true;
    setStopping(true);
  }

  async function sendAll() {
    stop.current = false;
    setStopping(false);
    setRunning(true);
    setError(null);
    setFailed([]);
    try {
      const { types } = await notificationAdminApi.previewTypes(token, to);
      setProgress({ done: 0, total: types.length });
      for (const [i, type] of types.entries()) {
        if (stop.current) break;
        try {
          await notificationAdminApi.preview(token, to, type);
        } catch (caught) {
          // Nothing will get through (e.g. no linked Discord): stop at the first one
          if (i === 0) throw caught;
          setFailed((list) => [...list, { type, error: errorMessage(caught) }]);
        }
        setProgress({ done: i + 1, total: types.length });
        if (i < types.length - 1) await sleep(1100);
      }
    } catch (caught) {
      setError(errorMessage(caught));
      setProgress(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card
      title="Contoh semua pesan"
      description="Kirim contoh setiap jenis notifikasi (data karangan) untuk melihat tampilannya. Contoh tidak masuk lonceng dan tidak mem-ping siapa pun."
    >
      {error && <FormAlert tone="error">{error}</FormAlert>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <NativeSelect
          wrapperClassName="sm:w-56"
          value={to}
          onChange={(event) => setTo(event.target.value as PreviewTarget)}
          disabled={running}
          aria-label="Kirim ke"
        >
          {ready.map((channel) => (
            <option key={channel.key} value={channel.key}>
              {channel.label}
            </option>
          ))}
          <option value="me">DM saya</option>
        </NativeSelect>
        {running ? (
          <Button type="button" variant="outline" disabled={stopping} onClick={requestStop}>
            <Square aria-hidden="true" />
            {stopping ? "Menghentikan…" : "Berhenti"}
          </Button>
        ) : (
          <Button type="button" onClick={() => void sendAll()}>
            <Send aria-hidden="true" />
            Kirim semua contoh
          </Button>
        )}
      </div>

      {progress && (
        <div className="space-y-1.5">
          <Progress value={(progress.done / progress.total) * 100} aria-label="Contoh terkirim" />
          <p className="text-xs text-muted-foreground tabular-nums">
            {progress.done}/{progress.total} terkirim
            {failed.length > 0 && `, ${failed.length} gagal`}
            {running && " · sekitar 1 detik per pesan"}
          </p>
        </div>
      )}
      {failed.length > 0 && (
        <ul className="space-y-1 text-xs text-destructive">
          {failed.map((item) => (
            <li key={item.type}>
              <span className="font-mono">{item.type}</span>: {item.error}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SetupRow({ label, env, check, detail, action }: { label: string; env: string; check: DiscordCheck; detail?: string; action?: React.ReactNode }) {
  const badge: { text: string; tone: Tone } = !check.set
    ? { text: "Belum diatur", tone: "neutral" }
    : check.ok === false
      ? { text: "Bermasalah", tone: "danger" }
      : check.ok
        ? { text: "Siap", tone: "success" }
        : { text: "Belum dicek", tone: "neutral" };

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs break-words text-muted-foreground">{check.ok === false ? check.error : (detail ?? env)}</p>
        {!check.set && <p className="font-mono text-xs text-faint">{env}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <StatusBadge tone={badge.tone} dot>
          {badge.text}
        </StatusBadge>
      </div>
    </li>
  );
}

function Deliveries({ onChanged }: { onChanged: () => void }) {
  const { token } = useAuth();
  const [{ status, channel, page }, setUrlState] = useQueryStates(urlState);
  const filters = { status: status ?? undefined, channel: channel ?? undefined, page };
  const result = useApiData(`discord-deliveries-${JSON.stringify(filters)}`, () => notificationAdminApi.deliveries(token, filters));
  const rows = result.data?.deliveries;
  const [resending, setResending] = useState<string | null>(null);

  async function resend(delivery: NotificationDelivery) {
    setResending(delivery.id);
    try {
      notify({ text: (await notificationAdminApi.resend(token, delivery.id)).message });
    } catch (caught) {
      notify({ text: errorMessage(caught), tone: "error" });
    } finally {
      setResending(null);
      result.reload();
      onChanged();
    }
  }

  const resendButton = (delivery: NotificationDelivery) =>
    (delivery.status === "failed" || delivery.status === "skipped") && (
      <Button type="button" variant="outline" size="xs" className="max-md:h-10 max-md:px-3" disabled={resending !== null} onClick={() => void resend(delivery)}>
        <RotateCw aria-hidden="true" className={resending === delivery.id ? "animate-spin" : undefined} />
        Kirim ulang
      </Button>
    );

  const badge = (delivery: NotificationDelivery) => <StatusBadge tone={statusLabels[delivery.status].tone}>{statusLabels[delivery.status].label}</StatusBadge>;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">Pesan bot</h2>
          <p className="mt-1 text-sm text-muted-foreground">7 hari terakhir. Pesan yang gagal dicoba lagi otomatis sampai 3 kali.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <NativeSelect
            wrapperClassName="sm:w-40"
            value={status ?? ""}
            onChange={(event) => void setUrlState({ status: (event.target.value || null) as DeliveryStatus | null, page: null })}
            aria-label="Status"
          >
            <option value="">Semua status</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value].label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            wrapperClassName="sm:w-40"
            value={channel ?? ""}
            onChange={(event) => void setUrlState({ channel: (event.target.value || null) as NotificationDelivery["channel"] | null, page: null })}
            aria-label="Tujuan"
          >
            <option value="">Semua tujuan</option>
            <option value="discord_channel">Channel server</option>
            <option value="discord_dm">Pesan langsung</option>
          </NativeSelect>
        </div>
      </div>

      {result.error && <ErrorState message={result.error} onRetry={result.reload} />}

      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <RefreshBar active={result.loading && Boolean(rows)} />
        {!rows && !result.error && <TableSkeleton rows={6} columns={5} />}
        {rows?.data.length === 0 && <EmptyState icon={Clock} title="Belum ada pesan" description="Tidak ada pesan Discord yang cocok dengan filter ini." />}

        {rows && rows.data.length > 0 && (
          <>
            <Table containerClassName="hidden md:block">
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Pesan</TableHead>
                  <TableHead>Tujuan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">
                    <span className="sr-only">Aksi</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.data.map((delivery) => (
                  <TableRow key={delivery.id} className="text-body">
                    <TableCell className="align-top whitespace-nowrap text-muted-foreground tabular-nums">{formatDateTime(delivery.created_at)}</TableCell>
                    <TableCell className="max-w-md align-top">
                      <span className="block text-foreground">{delivery.title}</span>
                      {delivery.error && <span className="mt-0.5 block text-xs break-words text-destructive">{delivery.error}</span>}
                    </TableCell>
                    <TableCell className="align-top">
                      <span className="block">{delivery.to}</span>
                      <span className="block text-xs text-muted-foreground">{delivery.channel === "discord_dm" ? "Pesan langsung" : "Channel server"}</span>
                    </TableCell>
                    <TableCell className="align-top">
                      {badge(delivery)}
                      {delivery.attempts > 1 && <span className="mt-1 block text-xs text-muted-foreground">{delivery.attempts} percobaan</span>}
                    </TableCell>
                    <TableCell className="text-right align-top">{resendButton(delivery)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <ul className="divide-y divide-border md:hidden">
              {rows.data.map((delivery) => (
                <li key={delivery.id} className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm text-foreground">{delivery.title}</p>
                    {badge(delivery)}
                  </div>
                  {delivery.error && <p className="text-xs break-words text-destructive">{delivery.error}</p>}
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {delivery.to} · <span className="tabular-nums">{formatDateTime(delivery.created_at)}</span>
                    </span>
                    {resendButton(delivery)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {rows && (
        <Pagination page={rows.current_page} lastPage={rows.last_page} total={rows.total} unit="pesan" onChange={(next) => void setUrlState({ page: next })} />
      )}
    </section>
  );
}
