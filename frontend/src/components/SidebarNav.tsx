"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavIcon from "./NavIcon";
import type { SidebarGroup } from "./SidebarLayout";

/** Grouped menu: small uppercase section labels, active item tinted with the primary color. */
export default function SidebarNav({ links, onNavigate }: { links: SidebarGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="space-y-6">
      {links.map((section) => (
        <div key={section.group}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-faint">{section.group}</p>
          <ul className="space-y-1">
            {section.items.map((link) => {
              const active = isActive(link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      active ? "bg-primary/10 text-accent" : "text-body hover:bg-surface-2 hover:text-heading"
                    }`}
                  >
                    <NavIcon name={link.icon} />
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
