"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setThemeMode, useResolvedTheme, useThemeMode, type ThemeMode } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Terang", icon: Sun },
  { value: "dark", label: "Gelap", icon: Moon },
  { value: "system", label: "Sistem", icon: Monitor },
];

/** Sun/moon button in the header; opens light, dark or follow-the-system. */
export default function ThemeToggle() {
  const mode = useThemeMode();
  const resolved = useResolvedTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Ganti tema" className="text-muted-foreground hover:text-foreground">
          {resolved === "dark" ? <Moon /> : <Sun />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => setThemeMode(value as ThemeMode)}>
          {themeOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="text-muted-foreground" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same choice as a three-way segmented control, for menus and sheets. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const mode = useThemeMode();

  return (
    <div role="radiogroup" aria-label="Tema" className={cn("grid grid-cols-3 gap-1 rounded-lg bg-muted p-1", className)}>
      {themeOptions.map((option) => {
        const selected = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setThemeMode(option.value)}
            className={cn(
              "flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <option.icon className="size-3.5" aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
