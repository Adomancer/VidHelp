"use client";

import { useEffect, useState } from "react";
import { adminApi, errorMessage, type AuthUser, type EraseReason, type Paginated, type RoleName, type UserStatus } from "@/lib/api";
import { roleLabel, statusLabel } from "@/lib/labels";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import FormAlert from "@/components/FormAlert";
import Modal from "@/components/Modal";
import SelectField from "@/components/SelectField";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";

const tabs: { label: string; status?: UserStatus }[] = [
  { label: "Menunggu persetujuan", status: "pending" },
  { label: "Aktif", status: "active" },
  { label: "Nonaktif", status: "inactive" },
  { label: "Diarsipkan", status: "archived" },
  { label: "Semua" },
];

const roles: RoleName[] = ["host", "operator", "finance", "admin"];

const statusStyles: Record<UserStatus, string> = {
  pending: "bg-yellow-500/15 text-warning",
  active: "bg-green-500/15 text-success",
  inactive: "bg-surface-3 text-body",
  archived: "bg-surface-2 text-muted",
};

type Notice = { tone: "success" | "error"; text: string } | null;

export default function AdminUsersPage() {
  const { user: me, token } = useAuth();
  const [status, setStatus] = useState<UserStatus | undefined>("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reloads, setReloads] = useState(0);
  const [result, setResult] = useState<{ key: string; users?: Paginated<AuthUser>; error?: string } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [erasing, setErasing] = useState<AuthUser | null>(null);

  const requestKey = JSON.stringify({ status, search, page, reloads });
  const loading = result?.key !== requestKey;

  useEffect(() => {
    let cancelled = false;

    adminApi
      .users(token, { status, search, page })
      .then((users) => !cancelled && setResult({ key: requestKey, users }))
      .catch((error) => !cancelled && setResult({ key: requestKey, error: errorMessage(error) }));

    return () => {
      cancelled = true;
    };
  }, [token, status, search, page, requestKey]);

  async function run(userId: string, action: () => Promise<unknown>) {
    setBusyId(userId);
    setNotice(null);
    try {
      const response = await action();
      const message = (response as { message?: string } | undefined)?.message;
      if (message) setNotice({ tone: "success", text: message });
      setReloads((count) => count + 1);
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusyId(null);
    }
  }

  function selectTab(next?: UserStatus) {
    setStatus(next);
    setPage(1);
  }

  const users = result?.users;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-heading">Manajemen Pengguna</h1>
        <button type="button" onClick={() => setCreating(true)} className="px-4 py-2 rounded-lg bg-primary text-sm text-white hover:bg-primary-hover">
          Buat akun
        </button>
      </div>

      {creating && (
        <CreateAccountForm
          onDone={(message) => {
            setCreating(false);
            setNotice({ tone: "success", text: message });
            selectTab("active");
            setReloads((count) => count + 1);
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {erasing && (
        <EraseForm
          user={erasing}
          onDone={(message) => {
            setErasing(null);
            setNotice({ tone: "success", text: message });
            setReloads((count) => count + 1);
          }}
          onCancel={() => setErasing(null)}
        />
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              onClick={() => selectTab(tab.status)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                status === tab.status ? "bg-primary text-white" : "bg-surface text-body hover:bg-surface-2"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(String(new FormData(event.currentTarget).get("search") ?? ""));
            setPage(1);
          }}
        >
          <input
            name="search"
            type="search"
            placeholder="Cari nama atau email…"
            className="w-full lg:w-72 px-4 py-2 rounded-lg bg-surface border border-stroke text-heading placeholder-faint outline-none focus:ring-2 focus:ring-primary"
          />
        </form>
      </div>

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {result?.error && <FormAlert tone="error">{result.error}</FormAlert>}

      <div className={`bg-surface border border-stroke rounded-[10px] shadow-card overflow-x-auto ${loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2 border-b border-stroke">
            <tr>
              <th className="px-4 py-3 font-medium">Pengguna</th>
              <th className="px-4 py-3 font-medium">Mendaftar</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Peran</th>
              <th className="px-4 py-3 font-medium text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stroke">
            {users?.data.map((user) => {
              const isMe = user.id === me.id;
              const busy = busyId === user.id;
              const erased = Boolean(user.erased_at);

              return (
                <tr key={user.id} className="text-body">
                  <td className="px-4 py-3">
                    <p className="text-heading">
                      {user.name}
                      {user.two_factor_enabled && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-primary/15 text-[10px] text-accent align-middle">2FA</span>
                      )}
                    </p>
                    {!erased && <p className="text-muted">{user.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {new Date(user.created_at).toLocaleDateString("id-ID")}
                    <span className="block text-xs">
                      {user.signup_source === "admin_created" ? "oleh admin" : user.has_password ? "email" : "Google"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-md text-xs ${statusStyles[user.status]}`}>
                      {erased ? "Dihapus" : statusLabel(user.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.roles[0]?.name ?? "host"}
                      disabled={isMe || busy || erased}
                      onChange={(event) => run(user.id, () => adminApi.setRole(token, user.id, event.target.value as RoleName))}
                      className="bg-surface-2 border border-stroke-strong rounded-md px-2 py-1 text-heading disabled:opacity-50"
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {roleLabel(role)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    {user.two_factor_enabled && !isMe && (
                      <ActionButton
                        tone="purple"
                        disabled={busy}
                        onClick={() =>
                          window.confirm(
                            `Reset 2FA untuk ${user.name}? Dia akan dikeluarkan dan harus mengatur 2FA lagi. Lakukan hanya kalau HP dan kode pemulihannya hilang.`
                          ) && run(user.id, () => adminApi.resetTwoFactor(token, user.id))
                        }
                      >
                        Reset 2FA
                      </ActionButton>
                    )}
                    {!erased && user.status !== "active" && (
                      <ActionButton tone="green" disabled={busy} onClick={() => run(user.id, () => adminApi.activateUser(token, user.id))}>
                        {user.status === "pending" ? "Setujui" : user.status === "archived" ? "Pulihkan" : "Aktifkan"}
                      </ActionButton>
                    )}
                    {user.status === "active" && !isMe && (
                      <ActionButton
                        disabled={busy}
                        onClick={() =>
                          window.confirm(`Nonaktifkan ${user.name} sementara? Dia tidak bisa masuk, tapi jadwalnya tetap ada.`) &&
                          run(user.id, () => adminApi.deactivateUser(token, user.id))
                        }
                      >
                        Nonaktifkan
                      </ActionButton>
                    )}
                    {(user.status === "active" || user.status === "inactive") && !isMe && (
                      <ActionButton
                        tone="red"
                        disabled={busy}
                        onClick={() =>
                          window.confirm(
                            `Arsipkan ${user.name}? Pakai ini kalau orangnya sudah keluar: tidak bisa masuk, slotnya berakhir hari ini, dan backup-nya dilepas.`
                          ) && run(user.id, () => adminApi.archiveUser(token, user.id))
                        }
                      >
                        Arsipkan
                      </ActionButton>
                    )}
                    {user.status === "archived" && !erased && (
                      <ActionButton tone="red" disabled={busy} onClick={() => setErasing(user)}>
                        Hapus permanen
                      </ActionButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {users && users.data.length === 0 && (
          <p className="px-4 py-8 text-center text-muted">
            {status === "pending" ? "Tidak ada yang menunggu persetujuan." : "Pengguna tidak ditemukan."}
          </p>
        )}
      </div>

      {users && users.last_page > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Halaman {users.current_page} dari {users.last_page} · {users.total} pengguna
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-md bg-surface disabled:opacity-40">
              Sebelumnya
            </button>
            <button type="button" disabled={page >= users.last_page} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-md bg-surface disabled:opacity-40">
              Berikutnya
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const buttonTones = {
  plain: "border border-stroke-strong text-body hover:bg-surface-2",
  green: "bg-green-600 text-white hover:bg-green-500",
  red: "border border-red-400/40 text-danger hover:bg-red-500/10",
  purple: "border border-primary/40 text-accent hover:bg-primary/10",
};

function ActionButton({
  tone = "plain",
  disabled,
  onClick,
  children,
}: {
  tone?: keyof typeof buttonTones;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`px-3 py-1.5 rounded-md disabled:opacity-50 ${buttonTones[tone]}`}>
      {children}
    </button>
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
    <Modal
      title="Buat akun"
      description="Akun langsung aktif. Berikan email dan kata sandinya ke orang tersebut untuk masuk."
      onClose={onCancel}
    >
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
        <div className="sm:col-span-2 flex gap-3">
          <div className="w-44">
            <SubmitButton loading={loading}>Buat akun</SubmitButton>
          </div>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-body hover:bg-surface-2">
            Batal
          </button>
        </div>
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
    <Modal
      title={`Hapus ${user.name} permanen`}
      description="Menghapus akun masuk, kontak, KTP, data bank, foto, dan surat sakit. Jam kerja, poin, dan slip gaji tetap ada tanpa nama. Tindakan ini tidak bisa dibatalkan."
      onClose={onCancel}
    >
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <SelectField label="Alasan" name="reason" error={errors.reason} options={eraseReasons} />
        <TextField label="Catatan (opsional)" name="note" maxLength={500} placeholder="mis. diminta lewat WhatsApp tgl 5 Okt" error={errors.note} />
        <div className="sm:col-span-2 flex gap-3">
          <div className="w-52">
            <SubmitButton loading={loading}>Hapus permanen</SubmitButton>
          </div>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-body hover:bg-surface-2">
            Batal
          </button>
        </div>
      </form>
    </Modal>
  );
}
