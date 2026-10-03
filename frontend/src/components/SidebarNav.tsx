"use client";

import { useState, useRef, useLayoutEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);

  // All groups open by default
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    if (!isGrouped(links)) return {};
    return Object.fromEntries(links.map((g) => [g.group, true]));
  });

  const toggle = (group: string) =>
    setOpen((prev) => ({ ...prev, [group]: !prev[group] }));

  const checkActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLAnchorElement>("[data-active='true']");
    if (!activeEl) {
      setPill(null);
      return;
    }
    setPill({
      top: activeEl.offsetTop,
      height: activeEl.offsetHeight,
    });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [pathname, open, measure]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const renderLink = (link: SidebarLink) => {
    const active = checkActive(link.href);
    return (
      <Link
        key={link.href}
        href={link.href}
        data-active={active}
        className={`relative z-10 block px-4 py-2 rounded-lg transition-colors duration-200 ${
          active ? "text-purple-300 font-medium" : "text-gray-300 hover:bg-slate-800/50 hover:text-white"
        }`}
      >
        {link.label}
      </Link>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      {pill && (
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 rounded-lg bg-purple-600/15 border border-purple-500/20 transition-all duration-300 ease-out"
          style={{ top: pill.top, height: pill.height }}
        />
      )}

      {!isGrouped(links) ? (
        <div className="space-y-1">{links.map(renderLink)}</div>
      ) : (
        links.map((section) => {
          const isOpen = open[section.group] ?? true;
          return (
            <div key={section.group} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(section.group)}
                className="w-full flex items-center justify-between px-4 py-1.5 rounded-lg hover:bg-slate-800/30 transition-colors group relative z-10"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-400 transition-colors">
                  {section.group}
                </span>
                <Chevron open={isOpen} />
              </button>

              <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  maxHeight: isOpen ? `${section.items.length * 44}px` : "0px",
                  opacity: isOpen ? 1 : 0,
                }}
              >
                <div className="space-y-1 mt-1">
                  {section.items.map(renderLink)}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
