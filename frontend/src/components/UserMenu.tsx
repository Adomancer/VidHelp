"use client";

import Link from "next/link";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { roleLabel } from "@/lib/labels";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "./AuthProvider";
import NavIcon, { type NavIconName } from "./NavIcon";
import { themeOptions } from "./ThemeToggle";
import UserAvatar from "./UserAvatar";

export interface AccountLink {
  href: string;
  label: string;
  icon: NavIconName;
}

/** The signed-in user at the bottom of the sidebar; opens account links, theme and logout. */
export default function UserMenu({ links = [] }: { links?: AccountLink[] }) {
  const { user, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const mode = useThemeMode();
  const roles = user.roles.map((role) => roleLabel(role.name)).join(", ");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={user.name} className="data-open:bg-sidebar-accent">
              <UserAvatar size="size-8 text-xs" />
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium text-sidebar-accent-foreground">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{roles}</span>
              </span>
              <ChevronsUpDown className="ml-auto text-muted-foreground" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="w-64">
            <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
              <UserAvatar size="size-9 text-sm" />
              <span className="grid min-w-0 leading-tight">
                <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {links.length > 0 && (
              <>
                <DropdownMenuGroup>
                  {links.map((link) => (
                    <DropdownMenuItem key={link.href} asChild>
                      <Link href={link.href} onClick={() => isMobile && setOpenMobile(false)}>
                        <NavIcon name={link.icon} className="size-4 text-muted-foreground" />
                        {link.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {(() => {
                  const current = themeOptions.find((option) => option.value === mode) ?? themeOptions[0];
                  return (
                    <>
                      <current.icon className="text-muted-foreground" aria-hidden="true" />
                      Tema
                      <span className="ml-auto text-xs text-muted-foreground">{current.label}</span>
                    </>
                  );
                })()}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={mode} onValueChange={(value) => setThemeMode(value as ThemeMode)}>
                  {themeOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <option.icon className="text-muted-foreground" aria-hidden="true" />
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
              <LogOut aria-hidden="true" />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
