"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Ban, KeyRound, MoreHorizontal, Search, Trash2, UserPlus, Users } from "lucide-react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { adminApi, errorMessage, type AuthUser, type EraseReason, type RoleName, type UserStatus } from "@/lib/api";
import { roleLabel, statusLabel } from "@/lib/labels";
import { inputClass } from "@/lib/ui";
import { useApiData, useInvalidate } from "@/lib/useApiData";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/ErrorState";
import FormActions from "@/components/FormActions";
import FormAlert from "@/components/FormAlert";
import { TableSkeleton, RefreshBar } from "@/components/Loading";
import Modal from "@/components/Modal";
import PageHeader from "@/components/PageHeader";
import Pagination from "@/components/Pagination";
import SelectField, { NativeSelect } from "@/components/SelectField";
import StatusBadge, { type Tone } from "@/components/StatusBadge";
import TextField from "@/components/TextField";
import { notify } from "@/components/Toast";
import ToggleGroup, { ShortLabel } from "@/components/ToggleGroup";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const tabs = [
  ["pending", "Menunggu persetujuan"],
  ["active", "Aktif"],
  ["inactive", "Nonaktif"],
  ["archived", "Diarsipkan"],
  ["all", "Semua"],
] as const;

type TabValue = (typeof tabs)[number][0];

/** Phones can't fit the full labels on one row, and the tabs shouldn't scroll sideways. */
const shortTabs: Record<TabValue, string> = { pending: "Menunggu", active: "Aktif", inactive: "Nonaktif", archived: "Arsip", all: "Semua" };

/** Tab, search and page live in the URL, so a refresh or a link keeps the same view. */
const urlState = {
  tab: parseAsStringLiteral(tabs.map(([value]) => value)).withDefault("pending"),
  q: parseAsString.withDefault(""),
  page: parseAsInteger.withDefault(1),
};

const roles: RoleName[] = ["host", "operator", "finance", "admin"];

const statusTones: Record<UserStatus, Tone> = {
  pending: "warning",
  active: "success",
  inactive: "neutral",
  archived: "neutral",
};

type Confirm = { kind: "reset2fa" | "deactivate" | "archive"; user: AuthUser } | { kind: "role"; user: AuthUser; role: RoleName } | null;

export default function AdminUsersPage() {
  const { user: me, token } = useAuth();
  const [{ tab, q: search, page }, setUrlState] = useQueryStates(urlState);
  const [query, setQuery] = useState(search);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [erasing, setErasing] = useState<AuthUser | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const status = tab === "all" ? undefined : tab;
  const result = useApiData(`admin-users-${JSON.stringify({ status, search, page })}`, () => adminApi.users(token, { status, search, page }));
  const invalidate = useInvalidate();
  const reloadUsers = () => invalidate("admin-users-");

  useEffect(() => () => clearTimeout(debounce.current), []);

  async function run(userId: string, action: () => Promise<unknown>) {
    setBusyId(userId);
    setError(null);
    try {
      const response = await action();
      const message = (response as { message?: string } | undefined)?.message;
      if (message) notify({ text: message });
      reloadUsers();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  function selectTab(next: TabValue) {
    void setUrlState({ tab: next, page: null });
  }

  function type(next: string) {
    setQuery(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void setUrlState({ q: next.trim(), page: null }), 300);
  }

  const users = result.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengguna"
        description="Setujui pendaftar baru, atur peran, dan kelola akun yang sudah tidak aktif."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <UserPlus aria-hidden="true" />
            Buat akun
          </Button>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <ToggleGroup
          label="Status pengguna"
          options={tabs.map(([value, label]) => ({ value, label: <ShortLabel short={shortTabs[value]} full={label} /> }))}
          value={tab}
          onChange={selectTab}
          fill
        />
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => type(event.target.value)}
            placeholder="Cari nama atau email…"
            aria-label="Cari pengguna"
            className={cn(inputClass, "pl-9")}
          />
        </div>
      </div>

      {error && <FormAlert tone="error">{error}</FormAlert>}
      {result.error && <ErrorState message={result.error} onRetry={result.reload} />}

      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:shadow-none">
        <RefreshBar active={result.loading && Boolean(users)} />
        {!users && !result.error && <TableSkeleton rows={6} columns={4} />}

        {users && users.data.length === 0 && (
          <EmptyState
            icon={Users}
            title={tab === "pending" ? "Tidak ada yang menunggu persetujuan" : "Pengguna tidak ditemukan"}
            description={search ? `Tidak ada yang cocok dengan "${search}".` : undefined}
          />
        )}

        {users && users.data.length > 0 && (
          <>
            {/* Laptop and tablet: a table */}
            <Table containerClassName="hidden md:block">
              <TableHeader>
                <TableRow>
                  <TableHead>Pengguna</TableHead>
                  <TableHead>Mendaftar</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Peran</TableHead>
                  <TableHead>
                    <span className="sr-only">Aksi</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.map((user) => (
                  <TableRow key={user.id} className="text-body hover:bg-muted/40">
                    <TableCell>
                      <UserCell user={user} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <Signup user={user} />
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge user={user} />
                    </TableCell>
                    <TableCell>
                      <RoleSelect user={user} disabled={user.id === me.id || busyId === user.id || Boolean(user.erased_at)} onConfirm={setConfirm} />
                    </TableCell>
                    <TableCell>
                      <RowActions user={user} isMe={user.id === me.id} busy={busyId === user.id} run={run} onConfirm={setConfirm} onErase={setErasing} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Phones: one card per user */}
            <ul className="divide-y divide-border md:hidden">
              {users.data.map((user) => (
                <li key={user.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <UserCell user={user} />
                    <UserStatusBadge user={user} />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <Signup user={user} inline />
                    <RoleSelect user={user} disabled={user.id === me.id || busyId === user.id || Boolean(user.erased_at)} onConfirm={setConfirm} />
                  </div>
                  <RowActions user={user} isMe={user.id === me.id} busy={busyId === user.id} run={run} onConfirm={setConfirm} onErase={setErasing} stretch />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {users && <Pagination page={users.current_page} lastPage={users.last_page} total={users.total} unit="pengguna" onChange={(next) => void setUrlState({ page: next })} />}

      {creating && (
        <CreateAccountForm
          onDone={(message) => {
            setCreating(false);
            notify({ text: message });
            selectTab("active");
            reloadUsers();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {erasing && (
        <EraseForm
          user={erasing}
          onDone={(message) => {
            setErasing(null);
            notify({ text: message });
            reloadUsers();
          }}
          onCancel={() => setErasing(null)}
        />
      )}

      {confirm?.kind === "role" && (
        <ConfirmDialog
          title={`Jadikan ${confirm.user.name} ${roleLabel(confirm.role)}?`}
          confirmLabel={`Jadikan ${roleLabel(confirm.role)}`}
          destructive={staffRoles.includes(confirm.role)}
          onConfirm={() => run(confirm.user.id, () => adminApi.setRole(token, confirm.user.id, confirm.role))}
          onClose={() => setConfirm(null)}
        >
          {staffRoles.includes(confirm.role)
            ? `${roleLabel(confirm.role)} bisa melihat KTP, rekening, dan penggajian semua host, serta mengelola semua akun. Pastikan ini orang yang tepat.`
            : `Peran ${roleLabel(confirm.user.roles[0]?.name ?? "host")} diganti menjadi ${roleLabel(confirm.role)}; aksesnya ikut berubah saat ia memuat halaman berikutnya.`}
        </ConfirmDialog>
      )}
      {confirm?.kind === "reset2fa" && (
        <ConfirmDialog
          title={`Reset 2FA ${confirm.user.name}?`}
          confirmLabel="Reset 2FA"
          onConfirm={() => run(confirm.user.id, () => adminApi.resetTwoFactor(token, confirm.user.id))}
          onClose={() => setConfirm(null)}
        >
          Dia akan dikeluarkan dan harus mengatur 2FA lagi. Lakukan hanya kalau HP dan kode pemulihannya hilang.
        </ConfirmDialog>
      )}
      {confirm?.kind === "deactivate" && (
        <ConfirmDialog
          title={`Nonaktifkan ${confirm.user.name}?`}
          confirmLabel="Nonaktifkan"
          destructive={false}
          onConfirm={() => run(confirm.user.id, () => adminApi.deactivateUser(token, confirm.user.id))}
          onClose={() => setConfirm(null)}
        >
          Sementara tidak bisa masuk, tapi jadwalnya tetap ada. Bisa diaktifkan lagi kapan saja.
        </ConfirmDialog>
      )}
      {confirm?.kind === "archive" && (
        <ConfirmDialog
          title={`Arsipkan ${confirm.user.name}?`}
          confirmLabel="Arsipkan"
          onConfirm={() => run(confirm.user.id, () => adminApi.archiveUser(token, confirm.user.id))}
          onClose={() => setConfirm(null)}
        >
          Pakai ini kalau orangnya sudah keluar: tidak bisa masuk, slotnya berakhir hari ini, dan backup-nya dilepas.
        </ConfirmDialog>
      )}
    </div>
  );
}

function UserCell({ user }: { user: AuthUser }) {
  const erased = Boolean(user.erased_at);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <UserAvatar user={user} size="size-9 text-sm" />
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <span className="truncate">{user.name}</span>
          {user.two_factor_enabled && (
            <StatusBadge tone="brand" className="h-5 px-1.5 text-[10px]">
              2FA
            </StatusBadge>
          )}
        </p>
        {!erased && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
      </div>
    </div>
  );
}

function Signup({ user, inline = false }: { user: AuthUser; inline?: boolean }) {
  const source = user.signup_source === "admin_created" ? "oleh admin" : user.has_password ? "email" : "Google";
  const date = new Date(user.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  return inline ? (
    <span>
      Daftar {date} · {source}
    </span>
  ) : (
    <>
      <span className="tabular-nums">{date}</span>
      <span className="block text-xs">{source}</span>
    </>
  );
}

function UserStatusBadge({ user }: { user: AuthUser }) {
  if (user.erased_at) return <StatusBadge tone="danger">Dihapus</StatusBadge>;
  return (
    <StatusBadge tone={statusTones[user.status]} dot>
      {statusLabel(user.status)}
    </StatusBadge>
  );
}

/** Roles that see every host's KTP, bank details and payroll. */
const staffRoles: RoleName[] = ["admin", "finance"];

/** Picking a role only asks first (arrow keys on a closed select change it without opening). */
function RoleSelect({ user, disabled, onConfirm }: { user: AuthUser; disabled: boolean; onConfirm: (confirm: Confirm) => void }) {
  const current = user.roles[0]?.name ?? "host";
  return (
    <NativeSelect
      small
      wrapperClassName="w-32"
      value={current}
      disabled={disabled}
      aria-label={`Peran ${user.name}`}
      onChange={(event) => {
        const role = event.target.value as RoleName;
        if (role !== current) onConfirm({ kind: "role", user, role });
      }}
    >
      {roles.map((role) => (
        <option key={role} value={role}>
          {roleLabel(role)}
        </option>
      ))}
    </NativeSelect>
  );
}

/** The likely next step as a button; everything else in the "…" menu. */
function RowActions({
  user,
  isMe,
  busy,
  run,
  onConfirm,
  onErase,
  stretch = false,
}: {
  user: AuthUser;
  isMe: boolean;
  busy: boolean;
  run: (userId: string, action: () => Promise<unknown>) => Promise<void>;
  onConfirm: (confirm: Confirm) => void;
  onErase: (user: AuthUser) => void;
  stretch?: boolean;
}) {
  const { token } = useAuth();
  const erased = Boolean(user.erased_at);
  const canActivate = !erased && user.status !== "active";
  const menu = [
    user.two_factor_enabled && !isMe && { key: "reset2fa", label: "Reset 2FA", icon: KeyRound, onSelect: () => onConfirm({ kind: "reset2fa", user }) },
    user.status === "active" && !isMe && { key: "deactivate", label: "Nonaktifkan", icon: Ban, onSelect: () => onConfirm({ kind: "deactivate", user }) },
    (user.status === "active" || user.status === "inactive") &&
      !isMe && { key: "archive", label: "Arsipkan", icon: Archive, destructive: true, onSelect: () => onConfirm({ kind: "archive", user }) },
    user.status === "archived" && !erased && { key: "erase", label: "Hapus permanen", icon: Trash2, destructive: true, onSelect: () => onErase(user) },
  ].filter(Boolean) as { key: string; label: string; icon: typeof Ban; destructive?: boolean; onSelect: () => void }[];

  if (!canActivate && menu.length === 0) return null;

  return (
    <div className={cn("flex items-center justify-end gap-2", stretch && "[&>button:first-child]:flex-1")}>
      {canActivate && (
        <Button type="button" size="sm" variant={user.status === "pending" ? "default" : "outline"} disabled={busy} onClick={() => run(user.id, () => adminApi.activateUser(token, user.id))}>
          {user.status === "pending" ? "Setujui" : user.status === "archived" ? "Pulihkan" : "Aktifkan"}
        </Button>
      )}
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="max-md:size-10" disabled={busy} aria-label={`Aksi lain untuk ${user.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {menu.map((item, index) => (
              <div key={item.key}>
                {item.destructive && index > 0 && !menu[index - 1].destructive && <DropdownMenuSeparator />}
                <DropdownMenuItem variant={item.destructive ? "destructive" : "default"} onSelect={item.onSelect}>
                  <item.icon aria-hidden="true" />
                  {item.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** An account the admin makes (e.g. a host who doesn't sign up): active straight away. */
function CreateAccountForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      adminApi.createUser(token, {
        name: formValue(data, "name"),
        email: formValue(data, "email"),
        password: formValue(data, "password"),
        role: formValue(data, "role") as RoleName,
      }),
    ({ message }) => onDone(message)
  );

  return (
    <Modal title="Buat akun" description="Akun langsung aktif. Berikan email dan kata sandinya ke orang tersebut untuk masuk." onClose={onCancel}>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <TextField label="Nama" name="name" autoComplete="off" error={errors.name} />
        <TextField label="Email" name="email" type="email" autoComplete="off" error={errors.email} />
        <TextField label="Kata sandi" name="password" type="text" autoComplete="new-password" placeholder="Minimal 8 karakter" error={errors.password} />
        <SelectField label="Peran" name="role" defaultValue="host" error={errors.role} options={roles.map((role) => ({ value: role, label: roleLabel(role) }))} />
        <FormActions loading={loading} submitLabel="Buat akun" onCancel={onCancel} />
      </form>
    </Modal>
  );
}

const eraseReasons: { value: EraseReason; label: string }[] = [
  { value: "banned", label: "Diblokir dari brand" },
  { value: "host_request", label: "Host minta datanya dihapus" },
];

/** Delete an archived account permanently (anonymized), with the reason it is allowed. */
function EraseForm({ user, onDone, onCancel }: { user: AuthUser; onDone: (message: string) => void; onCancel: () => void }) {
  const { token } = useAuth();
  const { loading, errors, error, handleSubmit } = useApiForm(
    (data) =>
      adminApi.eraseUser(token, user.id, {
        reason: formValue(data, "reason") as EraseReason,
        note: formValue(data, "note") || null,
      }),
    ({ message }) => onDone(message)
  );

  return (
    <Modal title={`Hapus ${user.name} permanen`} onClose={onCancel}>
      <FormAlert tone="warning">
        Menghapus akun masuk, kontak, KTP, data bank, foto, dan surat sakit. Jam kerja, poin, dan slip gaji tetap ada tanpa nama. Tindakan ini
        tidak bisa dibatalkan.
      </FormAlert>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <SelectField label="Alasan" name="reason" error={errors.reason} options={eraseReasons} />
        <TextField label="Catatan (opsional)" name="note" maxLength={500} placeholder="mis. diminta lewat WhatsApp tgl 5 Okt" error={errors.note} />
        <FormActions loading={loading} submitLabel="Hapus permanen" onCancel={onCancel} variant="danger" />
      </form>
    </Modal>
  );
}
