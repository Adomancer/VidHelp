"use client";

import { useEffect, useState } from "react";
import { adminApi, errorMessage, type AuthUser, type EraseReason, type Paginated, type RoleName, type UserStatus } from "@/lib/api";
import { formValue, useApiForm } from "@/lib/useApiForm";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";
import SelectField from "@/components/SelectField";
import SubmitButton from "@/components/SubmitButton";
import TextField from "@/components/TextField";

const tabs: { label: string; status?: UserStatus }[] = [
  { label: "Pending approval", status: "pending" },
  { label: "Active", status: "active" },
  { label: "Inactive", status: "inactive" },
  { label: "Archived", status: "archived" },
  { label: "All" },
];

const roles: RoleName[] = ["host", "operator", "finance", "admin"];

const statusStyles: Record<UserStatus, string> = {
  pending: "bg-yellow-500/15 text-yellow-200",
  active: "bg-green-500/15 text-green-300",
  inactive: "bg-slate-700 text-gray-300",
  archived: "bg-slate-800 text-gray-400",
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
        <h1 className="text-2xl font-bold text-white">User Management</h1>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className="px-4 py-2 rounded-lg bg-purple-600 text-sm text-white hover:bg-purple-500">
            Create account
          </button>
        )}
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
                status === tab.status ? "bg-purple-600 text-white" : "bg-slate-900 text-gray-300 hover:bg-slate-800"
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
            placeholder="Search name or email…"
            className="w-full lg:w-72 px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-purple-500"
          />
        </form>
      </div>

      {notice && <FormAlert tone={notice.tone}>{notice.text}</FormAlert>}
      {result?.error && <FormAlert tone="error">{result.error}</FormAlert>}

      <div className={`bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto ${loading ? "opacity-60" : ""}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-400 border-b border-slate-800">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Signed up</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {users?.data.map((user) => {
              const isMe = user.id === me.id;
              const busy = busyId === user.id;
              const erased = Boolean(user.erased_at);

              return (
                <tr key={user.id} className="text-gray-200">
                  <td className="px-4 py-3">
                    <p className="text-white">
                      {user.name}
                      {user.two_factor_enabled && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-500/15 text-[10px] text-purple-200 align-middle">2FA</span>
                      )}
                    </p>
                    {!erased && <p className="text-gray-400">{user.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {new Date(user.created_at).toLocaleDateString()}
                    <span className="block text-xs">
                      {user.signup_source === "admin_created" ? "by admin" : user.has_password ? "email" : "Google"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-md text-xs capitalize ${statusStyles[user.status]}`}>
                      {erased ? "deleted" : user.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.roles[0]?.name ?? "host"}
                      disabled={isMe || busy || erased}
                      onChange={(event) => run(user.id, () => adminApi.setRole(token, user.id, event.target.value as RoleName))}
                      className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-white disabled:opacity-50"
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
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
                            `Reset 2FA for ${user.name}? They will be signed out and must set up 2FA again. Only do this if they lost their phone and recovery codes.`
                          ) && run(user.id, () => adminApi.resetTwoFactor(token, user.id))
                        }
                      >
                        Reset 2FA
                      </ActionButton>
                    )}
                    {!erased && user.status !== "active" && (
                      <ActionButton tone="green" disabled={busy} onClick={() => run(user.id, () => adminApi.activateUser(token, user.id))}>
                        {user.status === "pending" ? "Approve" : user.status === "archived" ? "Restore" : "Activate"}
                      </ActionButton>
                    )}
                    {user.status === "active" && !isMe && (
                      <ActionButton
                        disabled={busy}
                        onClick={() =>
                          window.confirm(`Deactivate ${user.name} for now? They can't sign in, but their schedule stays.`) &&
                          run(user.id, () => adminApi.deactivateUser(token, user.id))
                        }
                      >
                        Deactivate
                      </ActionButton>
                    )}
                    {(user.status === "active" || user.status === "inactive") && !isMe && (
                      <ActionButton
                        tone="red"
                        disabled={busy}
                        onClick={() =>
                          window.confirm(
                            `Archive ${user.name}? Use this when someone leaves: they can't sign in, their slots end today, and their backups are released.`
                          ) && run(user.id, () => adminApi.archiveUser(token, user.id))
                        }
                      >
                        Archive
                      </ActionButton>
                    )}
                    {user.status === "archived" && !erased && (
                      <ActionButton tone="red" disabled={busy} onClick={() => setErasing(user)}>
                        Delete permanently
                      </ActionButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {users && users.data.length === 0 && (
          <p className="px-4 py-8 text-center text-gray-400">
            {status === "pending" ? "No one is waiting for approval." : "No users found."}
          </p>
        )}
      </div>

      {users && users.last_page > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>
            Page {users.current_page} of {users.last_page} · {users.total} users
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-md bg-slate-900 disabled:opacity-40">
              Previous
            </button>
            <button type="button" disabled={page >= users.last_page} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-md bg-slate-900 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const buttonTones = {
  plain: "border border-slate-700 text-gray-300 hover:bg-slate-800",
  green: "bg-green-600 text-white hover:bg-green-500",
  red: "border border-red-400/40 text-red-300 hover:bg-red-500/10",
  purple: "border border-purple-400/40 text-purple-200 hover:bg-purple-500/10",
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
    <Card title="Create account" description="The account is active straight away. Give the person their email and password to sign in.">
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <TextField label="Name" name="name" autoComplete="off" error={errors.name} />
        <TextField label="Email" name="email" type="email" autoComplete="off" error={errors.email} />
        <TextField label="Password" name="password" type="text" autoComplete="new-password" placeholder="At least 8 characters" error={errors.password} />
        <SelectField label="Role" name="role" defaultValue="host" error={errors.role} options={roles.map((role) => ({ value: role, label: role }))} />
        <div className="sm:col-span-2 flex gap-3">
          <div className="w-44">
            <SubmitButton loading={loading}>Create account</SubmitButton>
          </div>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-gray-300 hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

const eraseReasons: { value: EraseReason; label: string }[] = [
  { value: "banned", label: "Banned from a brand" },
  { value: "host_request", label: "The host asked to be deleted" },
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
    <Card
      title={`Delete ${user.name} permanently`}
      description="Wipes sign-in, contact details, KTP, bank details, photos and sick letters. Hours, points and salary slips stay, without the name. This can't be undone."
    >
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && (
          <div className="sm:col-span-2">
            <FormAlert tone="error">{error}</FormAlert>
          </div>
        )}
        <SelectField label="Reason" name="reason" error={errors.reason} options={eraseReasons} />
        <TextField label="Note (optional)" name="note" maxLength={500} placeholder="e.g. asked by WhatsApp on 5 Oct" error={errors.note} />
        <div className="sm:col-span-2 flex gap-3">
          <div className="w-52">
            <SubmitButton loading={loading}>Delete permanently</SubmitButton>
          </div>
          <button type="button" onClick={onCancel} className="px-4 py-3 rounded-xl text-gray-300 hover:bg-slate-800">
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}
