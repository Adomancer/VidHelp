"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import UserAvatar from "./UserAvatar";

/** Avatar + name in the top header; opens a dropdown with the email and logout. */
export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Close when clicking outside the menu
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={menu}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Menu akun"
        className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-surface-2"
      >
        <UserAvatar size="w-9 h-9" />
        <span className="hidden sm:block max-w-40 truncate text-sm font-medium text-heading">{user.name}</span>
        <svg className={`hidden sm:block w-4 h-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-[10px] border border-stroke bg-surface shadow-xl">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-stroke">
            <UserAvatar size="w-10 h-10" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-heading truncate">{user.name}</p>
              <p className="text-xs text-muted truncate">{user.email}</p>
            </div>
          </div>
          <div className="p-2">
            <button
              type="button"
              onClick={logout}
              className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-body hover:bg-surface-2 hover:text-heading"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Keluar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
