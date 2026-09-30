"use client";

import { useState } from "react";
import Link from "next/link";
import type { SidebarLink, SidebarGroup } from "./SidebarLayout";

/** Return true when the array contains grouped links. */
function isGrouped(links: SidebarLink[] | SidebarGroup[]): links is SidebarGroup[] {
  return links.length > 0 && "group" in links[0];
}

/** Chevron icon that rotates when the group is open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function SidebarNav({ links }: { links: SidebarLink[] | SidebarGroup[] }) {
  // All groups open by default
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    if (!isGrouped(links)) return {};
    return Object.fromEntries(links.map((g) => [g.group, true]));
  });

  const toggle = (group: string) =>
    setOpen((prev) => ({ ...prev, [group]: !prev[group] }));

  if (!isGrouped(links)) {
    return (
      <>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="block px-4 py-2 rounded-lg text-gray-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            {link.label}
          </Link>
        ))}
      </>
    );
  }

  return (
    <>
      {links.map((section) => {
        const isOpen = open[section.group] ?? true;
        return (
          <div key={section.group} className="mb-1">
            <button
              type="button"
              onClick={() => toggle(section.group)}
              className="w-full flex items-center justify-between px-4 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors group"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-400 transition-colors">
                {section.group}
              </span>
              <Chevron open={isOpen} />
            </button>

            <div
              className="overflow-hidden transition-all duration-200 ease-in-out"
              style={{
                maxHeight: isOpen ? `${section.items.length * 44}px` : "0px",
                opacity: isOpen ? 1 : 0,
              }}
            >
              {section.items.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block px-4 py-2 rounded-lg text-gray-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
