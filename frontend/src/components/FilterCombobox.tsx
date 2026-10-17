"use client";

import { useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
  /** A second line under the label, e.g. brand and dates. */
  description?: string;
  /** On the right, e.g. a count. */
  meta?: string;
}

interface FilterComboboxProps {
  id: string;
  options: FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  /** Shown when the search finds nothing. */
  empty?: string;
  className?: string;
}

/** Items rendered at first; scrolling to the bottom of the list shows this many more. */
const PAGE = 30;

/**
 * A filter you can type into: the list narrows as you type, shows more as you scroll, works
 * with the arrow keys and Enter, and has an ✕ to clear the choice.
 */
export default function FilterCombobox({ id, options, value, onChange, placeholder, empty = "Tidak ada hasil.", className }: FilterComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const selected = options.find((option) => option.value === value);

  const query = search.trim().toLowerCase();
  const matches = query ? options.filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(query)) : options;
  const shown = matches.slice(0, limit);

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSearch("");
      setLimit(PAGE);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Popover open={open} onOpenChange={openChange}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("h-11 w-full justify-between bg-card pr-3 font-normal shadow-xs md:h-11", selected && "pr-16")}
          >
            <span className={cn("truncate", selected ? "text-foreground" : "text-muted-foreground")}>{selected ? selected.label : placeholder}</span>
            <ChevronsUpDown className="text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <Command shouldFilter={false}>
            <CommandInput
              value={search}
              onValueChange={(next) => {
                setSearch(next);
                setLimit(PAGE);
              }}
              placeholder="Ketik untuk mencari…"
            />
            <CommandList
              onScroll={(event) => {
                const list = event.currentTarget;
                if (list.scrollTop + list.clientHeight >= list.scrollHeight - 40 && limit < matches.length) setLimit(limit + PAGE);
              }}
            >
              <CommandEmpty>{empty}</CommandEmpty>
              <CommandGroup>
                {shown.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    data-checked={option.value === value}
                    onSelect={() => {
                      onChange(option.value);
                      openChange(false);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.description && <span className="block truncate text-xs text-muted-foreground">{option.description}</span>}
                    </span>
                    {option.meta && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{option.meta}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
              {shown.length < matches.length && (
                <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                  {shown.length} dari {matches.length} · gulir untuk melihat lagi
                </p>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Hapus pilihan ${selected.label}`}
          className="absolute top-1/2 right-9 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
