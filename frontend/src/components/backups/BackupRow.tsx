"use client";

import { type BackupRequest } from "@/lib/api";
import { APP_TIME_ZONE, formatClock, formatDay, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BackupStatusBadge, LetterBadge, reasonLabels } from "../BackupBadges";
import UserAvatar from "../UserAvatar";
import { hoursOf } from "./shared";

/** "Sab", "17", "Okt" in a tile, like a calendar page. */
export function DateTile({ iso }: { iso: string }) {
  const date = new Date(iso);
  const part = (options: Intl.DateTimeFormatOptions) => date.toLocaleDateString("id-ID", { ...options, timeZone: APP_TIME_ZONE });
  return (
    <span className="flex w-14 shrink-0 flex-col items-center self-start rounded-lg border border-border bg-muted/40 py-1.5 leading-tight" aria-hidden="true">
      <span className="text-[11px] font-medium text-muted-foreground uppercase">{part({ weekday: "short" })}</span>
      <span className="text-xl font-semibold text-foreground tabular-nums">{part({ day: "numeric" })}</span>
      <span className="text-[11px] text-muted-foreground">{part({ month: "short" })}</span>
    </span>
  );
}

/** One line of the table; the row (or its button) opens the details. */
export function BackupRow({ backup, onOpen }: { backup: BackupRequest; onOpen: () => void }) {
  const running = new Date(backup.end_at) > new Date();
  const waiting = backup.status === "open" || backup.status === "pending";
  const nominees = backup.nominees?.length ?? 0;

  return (
    <tr
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(key) => {
        if (key.target === key.currentTarget && (key.key === "Enter" || key.key === " ")) {
          key.preventDefault();
          onOpen();
        }
      }}
      className={cn("h-16 cursor-pointer transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/50", !running && "text-muted-foreground")}
    >
      <td className="px-4 py-2 whitespace-nowrap">
        <span className="block font-medium text-foreground">{formatDay(backup.start_at)}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatClock(backup.start_at)}–{formatClock(backup.end_at)} · {formatDuration(hoursOf(backup))}
        </span>
      </td>
      <td className="max-w-56 px-3 py-2">
        <span className="flex items-center gap-2.5">
          {backup.requester && <UserAvatar user={backup.requester.user} size="size-8 text-xs" />}
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">{backup.requester?.user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{backup.brand.name}</span>
          </span>
        </span>
      </td>
      <td className="hidden max-w-48 px-3 py-2 lg:table-cell">
        <span className="block text-foreground">{reasonLabels[backup.reason_type]}</span>
        <span className="block truncate text-xs text-muted-foreground" title={backup.reason ?? undefined}>
          {backup.reason ?? "–"}
        </span>
      </td>
      <td className="max-w-48 px-3 py-2">
        {backup.status === "filled" && backup.filler ? (
          <span className="flex items-center gap-1.5 font-medium text-success">
            <UserAvatar user={backup.filler.user} size="size-5 text-[9px]" />
            <span className="truncate">{backup.filler.user.name}</span>
          </span>
        ) : waiting ? (
          <>
            <span className="block text-foreground tabular-nums">{backup.applicants_count ?? 0} pendaftar</span>
            {nominees > 0 && <span className="block text-xs text-muted-foreground">diminta ke {nominees} host</span>}
          </>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </td>
      <td className="hidden px-3 py-2 xl:table-cell">
        {backup.letter_status === "not_needed" ? <span className="text-muted-foreground">–</span> : <LetterBadge status={backup.letter_status} />}
      </td>
      <td className="px-3 py-2">
        <BackupStatusBadge status={backup.status} />
      </td>
      <td className="px-4 py-2 text-right">
        <Button
          type="button"
          size="sm"
          variant={running && waiting ? "default" : "outline"}
          onClick={(click) => {
            click.stopPropagation();
            onOpen();
          }}
        >
          {running && backup.status === "pending" ? "Cek pendaftar" : running && backup.status === "open" ? "Tunjuk" : "Detail"}
        </Button>
      </td>
    </tr>
  );
}
