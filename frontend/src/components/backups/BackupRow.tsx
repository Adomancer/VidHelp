"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { type BackupRequest } from "@/lib/api";
import { APP_TIME_ZONE, formatClock, formatDay, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BackupStatusBadge, LetterBadge, reasonLabels } from "../BackupBadges";
import UserAvatar from "../UserAvatar";
import { TruncatedCell } from "../data-table";
import { hoursOf, type Tab } from "./shared";

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

/** Table columns for BackupDesk's DataTable (sticky first column, tooltips on long reasons). */
export function createBackupColumns(tab: Tab, onOpen: (backup: BackupRequest) => void): ColumnDef<BackupRequest>[] {
  return [
    {
      id: "schedule",
      accessorFn: (row) => row.start_at,
      header: "Jadwal",
      cell: ({ row }) => {
        const backup = row.original;
        return (
          <div className="whitespace-nowrap">
            <span className="block font-medium text-foreground">{formatDay(backup.start_at)}</span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {formatClock(backup.start_at)}–{formatClock(backup.end_at)} · {formatDuration(hoursOf(backup))}
            </span>
          </div>
        );
      },
    },
    {
      id: "requester",
      accessorFn: (row) => row.requester?.user.name ?? "",
      header: "Host",
      meta: { cellClassName: "max-w-56" },
      cell: ({ row }) => {
        const backup = row.original;
        return (
          <span className="flex items-center gap-2.5">
            {backup.requester && <UserAvatar user={backup.requester.user} size="size-8 text-xs" />}
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground">{backup.requester?.user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{backup.brand.name}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: "reason",
      accessorFn: (row) => reasonLabels[row.reason_type],
      header: "Alasan",
      meta: { headClassName: "hidden lg:table-cell", cellClassName: "hidden max-w-48 lg:table-cell" },
      cell: ({ row }) => {
        const backup = row.original;
        return (
          <div className="min-w-0">
            <span className="block text-foreground">{reasonLabels[backup.reason_type]}</span>
            <TruncatedCell text={backup.reason} className="max-w-44 text-xs text-muted-foreground" />
          </div>
        );
      },
    },
    {
      id: "cover",
      enableSorting: false,
      header: tab === "filled" ? "Pengganti" : "Pendaftar / pengganti",
      meta: { cellClassName: "max-w-48" },
      cell: ({ row }) => {
        const backup = row.original;
        const waiting = backup.status === "open" || backup.status === "pending";
        const nominees = backup.nominees?.length ?? 0;

        if (backup.status === "filled" && backup.filler) {
          return (
            <span className="flex items-center gap-1.5 font-medium text-success">
              <UserAvatar user={backup.filler.user} size="size-5 text-[9px]" />
              <span className="truncate">{backup.filler.user.name}</span>
            </span>
          );
        }
        if (waiting) {
          return (
            <>
              <span className="block text-foreground tabular-nums">{backup.applicants_count ?? 0} pendaftar</span>
              {nominees > 0 && <span className="block text-xs text-muted-foreground">diminta ke {nominees} host</span>}
            </>
          );
        }
        return <span className="text-muted-foreground">–</span>;
      },
    },
    {
      id: "letter",
      enableSorting: false,
      header: "Surat sakit",
      meta: { headClassName: "hidden xl:table-cell", cellClassName: "hidden xl:table-cell" },
      cell: ({ row }) => {
        const backup = row.original;
        return backup.letter_status === "not_needed" ? <span className="text-muted-foreground">–</span> : <LetterBadge status={backup.letter_status} />;
      },
    },
    {
      id: "status",
      enableSorting: false,
      header: "Status",
      cell: ({ row }) => <BackupStatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      enableSorting: false,
      header: "Aksi",
      meta: { align: "right" },
      cell: ({ row }) => {
        const backup = row.original;
        const running = new Date(backup.end_at) > new Date();
        const waiting = backup.status === "open" || backup.status === "pending";

        return (
          <Button
            type="button"
            size="sm"
            variant={running && waiting ? "default" : "outline"}
            onClick={(click) => {
              click.stopPropagation();
              onOpen(backup);
            }}
          >
            {running && backup.status === "pending" ? "Cek pendaftar" : running && backup.status === "open" ? "Tunjuk" : "Detail"}
          </Button>
        );
      },
    },
  ];
}

/** Mobile card row for BackupDesk's DataTable. */
export function BackupMobileCard({ backup, onOpen }: { backup: BackupRequest; onOpen: () => void }) {
  const running = new Date(backup.end_at) > new Date();

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 outline-none hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-muted/50",
        !running && "text-muted-foreground"
      )}
    >
      {backup.requester && <UserAvatar user={backup.requester.user} size="size-9 text-xs" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{backup.requester?.user.name}</span>
        <span className="block truncate text-xs text-muted-foreground tabular-nums">
          {formatDay(backup.start_at)} · {formatClock(backup.start_at)}–{formatClock(backup.end_at)} · {backup.brand.name}
        </span>
        <span className="mt-1 block">
          <BackupStatusBadge status={backup.status} />
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
    </button>
  );
}
