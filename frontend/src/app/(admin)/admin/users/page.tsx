"use client";

import { useEffect, useState } from "react";
import { adminApi, errorMessage, type AuthUser, type Paginated, type RoleName, type UserStatus } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import FormAlert from "@/components/FormAlert";

const tabs: { label: string; status?: UserStatus }[] = [
  { label: "Pending approval", status: "pending" },
  { label: "Active", status: "active" },
  { label: "Inactive", status: "inactive" },
  { label: "All" },
];

const roles: RoleName[] = ["host", "operator", "admin"];

const statusStyles: Record<UserStatus, string> = {
  pending: "bg-yellow-500/15 text-yellow-200",
  active: "bg-green-500/15 text-green-300",
  inactive: "bg-slate-700 text-gray-300",
  archived: "bg-slate-800 text-gray-400",
};

export default function AdminUsersPage() {
  const { user: me, token } = useAuth();
  const [status, setStatus] = useState<UserStatus | undefined>("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reloads, setReloads] = useState(0);
  const [result, setResult] = useState<{ key: string; users?: Paginated<AuthUser>; error?: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    setActionError(null);
    try {
      await action();
      setReloads((count) => count + 1);
    } catch (error) {
      setActionError(errorMessage(error));
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
      <h1 className="text-2xl font-bold text-white">User Management</h1>

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

      {actionError && <FormAlert tone="error">{actionError}</FormAlert>}
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

              return (
                <tr key={user.id} className="text-gray-200">
                  <td className="px-4 py-3">
                    <p className="text-white">
                      {user.name}
                      {user.two_factor_enabled && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-purple-500/15 text-[10px] text-purple-200 align-middle">2FA</span>
                      )}
                    </p>
                    <p className="text-gray-400">{user.email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                    {new Date(user.created_at).toLocaleDateString()}
                    <span className="block text-xs">
                      {user.signup_source === "admin_created" ? "by admin" : user.has_password ? "email" : "Google"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-md text-xs capitalize ${statusStyles[user.status]}`}>{user.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.roles[0]?.name ?? "host"}
                      disabled={isMe || busy}
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
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {user.status !== "active" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(user.id, () => adminApi.activateUser(token, user.id))}
                        className="px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"
                      >
                        {user.status === "pending" ? "Approve" : "Activate"}
                      </button>
                    )}
                    {user.two_factor_enabled && !isMe && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Reset 2FA for ${user.name}? They will be signed out and must set up 2FA again. Only do this if they lost their phone and recovery codes.`)) {
                            run(user.id, () => adminApi.resetTwoFactor(token, user.id));
                          }
                        }}
                        className="mr-2 px-3 py-1.5 rounded-md border border-purple-400/40 text-purple-200 hover:bg-purple-500/10 disabled:opacity-50"
                      >
                        Reset 2FA
                      </button>
                    )}
                    {user.status === "active" && !isMe && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(user.id, () => adminApi.deactivateUser(token, user.id))}
                        className="px-3 py-1.5 rounded-md border border-slate-700 text-gray-300 hover:bg-slate-800 disabled:opacity-50"
                      >
                        Deactivate
                      </button>
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
