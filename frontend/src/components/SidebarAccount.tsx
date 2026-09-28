"use client";

import { useAuth } from "./AuthProvider";
import UserAvatar from "./UserAvatar";

/** Signed-in user + logout, pinned to the bottom of the desktop sidebars. */
export default function SidebarAccount() {
  const { user, logout } = useAuth();

  return (
    <div className="border-t border-slate-800 pt-4 space-y-3">
      <div className="flex items-center gap-3 min-w-0">
        <UserAvatar />
        <div className="min-w-0">
          <p className="text-sm text-white truncate">{user.name}</p>
          <p className="text-xs text-gray-400 truncate">{user.email}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={logout}
        className="w-full px-4 py-2 rounded-lg text-sm text-gray-300 border border-slate-700 hover:bg-slate-800 hover:text-white transition-colors"
      >
        Log out
      </button>
    </div>
  );
}
