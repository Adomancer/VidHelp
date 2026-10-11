"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Monitor, Moon, Search, Sun } from "lucide-react";
import { operatorApi } from "@/lib/api";
import { setThemeMode } from "@/lib/theme";
import { useApiData } from "@/lib/useApiData";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAuth } from "./AuthProvider";
import NavIcon from "./NavIcon";
import type { SidebarGroup } from "./SidebarLayout";
import UserAvatar from "./UserAvatar";

interface CommandMenuProps {
  links: SidebarGroup[];
  /** Picked hosts open at `${hostSearchPath}${id}` (admin: the host page with its detail panel). No host search without it. */
  hostSearchPath?: string;
}

/** Header search button plus the ⌘K / Ctrl+K palette: jump to a page, a host, or switch theme. */
export default function CommandMenu({ links, hostSearchPath }: CommandMenuProps) {
  const router = useRouter();
  const { token, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => () => clearTimeout(debounce.current), []);

  const searchHosts = Boolean(hostSearchPath) && open && query.length >= 2;
  const hosts = useApiData(`palette-hosts|${searchHosts}|${query}`, () =>
    searchHosts ? operatorApi.hosts(token, { search: [query], page: 1 }) : Promise.resolve(null)
  );

  function type(next: string) {
    setText(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(next.trim()), 200);
  }

  function run(action: () => void) {
    setOpen(false);
    type("");
    action();
  }

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Cari halaman atau host"
        className="h-9 w-9 justify-center gap-2 px-0 text-muted-foreground shadow-none md:w-56 md:justify-start md:px-3 lg:w-64"
      >
        <Search aria-hidden="true" />
        <span className="hidden flex-1 text-left font-normal md:inline">Cari…</span>
        <kbd className="pointer-events-none hidden h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground md:inline-flex">
          {isMac ? "⌘" : "Ctrl"} K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen} title="Cari" description="Cari halaman atau host" className="sm:max-w-xl">
        <Command loop>
          <CommandInput value={text} onValueChange={type} placeholder={hostSearchPath ? "Cari halaman atau nama host…" : "Cari halaman…"} />
          <CommandList className="max-h-[min(24rem,60vh)]">
            <CommandEmpty>{hosts.loading && searchHosts ? "Mencari…" : "Tidak ada hasil."}</CommandEmpty>

            {searchHosts && hosts.data && hosts.data.data.length > 0 && (
              <CommandGroup heading="Host">
                {hosts.data.data.slice(0, 6).map((host) => (
                  <CommandItem
                    key={host.id}
                    value={`host-${host.id}`}
                    keywords={[host.user.name, host.user.email, query]}
                    onSelect={() => run(() => router.push(`${hostSearchPath}${host.id}`))}
                  >
                    <UserAvatar user={host.user} size="size-6 text-[10px]" />
                    <span className="truncate">{host.user.name}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">{host.user.email}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {links.map((section) => (
              <CommandGroup key={section.group} heading={section.group}>
                {section.items.map((link) => (
                  <CommandItem key={link.href} value={link.href} keywords={[link.label, section.group]} onSelect={() => run(() => router.push(link.href))}>
                    <NavIcon name={link.icon} className="size-4 text-muted-foreground" />
                    {link.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            <CommandSeparator />
            <CommandGroup heading="Tema">
              <CommandItem value="theme-light" keywords={["terang", "light", "tema"]} onSelect={() => run(() => setThemeMode("light"))}>
                <Sun className="text-muted-foreground" aria-hidden="true" />
                Mode terang
              </CommandItem>
              <CommandItem value="theme-dark" keywords={["gelap", "dark", "tema"]} onSelect={() => run(() => setThemeMode("dark"))}>
                <Moon className="text-muted-foreground" aria-hidden="true" />
                Mode gelap
              </CommandItem>
              <CommandItem value="theme-system" keywords={["sistem", "system", "tema"]} onSelect={() => run(() => setThemeMode("system"))}>
                <Monitor className="text-muted-foreground" aria-hidden="true" />
                Ikuti sistem
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Akun">
              <CommandItem value="logout" keywords={["keluar", "logout"]} onSelect={() => run(() => void logout())}>
                <LogOut className="text-muted-foreground" aria-hidden="true" />
                Keluar
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
