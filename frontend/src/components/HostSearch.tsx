"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { operatorApi, type HostListItem } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";
import UserAvatar from "./UserAvatar";

/** One thing being searched for: a host picked from the list, or typed text (name or email). */
export type SearchChip =
  | { kind: "host"; id: string; name: string; avatar_url: string | null }
  | { kind: "text"; text: string };

type Option = { kind: "text"; text: string } | { kind: "host"; host: HostListItem };

interface HostSearchProps {
  value: SearchChip[];
  onChange: (chips: SearchChip[]) => void;
}

/**
 * Search box with the host list under it: type to narrow it, pick several hosts, or press
 * Enter to search the typed text. Each pick becomes a chip; the list shows hosts matching any.
 */
export default function HostSearch({ value, onChange }: HostSearchProps) {
  const { token } = useAuth();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listId = useId();

  // Only fetch while the list is open
  const suggestions = useApiData(`host-suggest|${query}`, () => operatorApi.hosts(token, { search: query ? [query] : [], page: 1 }), { enabled: open, keepPrevious: true });

  useEffect(() => {
    function closeOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOutside);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      clearTimeout(debounce.current);
    };
  }, []);

  const picked = new Set(value.flatMap((chip) => (chip.kind === "host" ? [chip.id] : [])));
  const typed = text.trim();
  // Narrow what's already loaded right away; the server's answer for the new text follows
  const hosts = (suggestions.data?.data ?? []).filter(
    (host) => !picked.has(host.id) && `${host.user.name} ${host.user.email}`.toLowerCase().includes(typed.toLowerCase())
  );
  const options: Option[] = [
    ...(typed && !value.some((chip) => chip.kind === "text" && chip.text.toLowerCase() === typed.toLowerCase())
      ? [{ kind: "text" as const, text: typed }]
      : []),
    ...hosts.map((host) => ({ kind: "host" as const, host })),
  ];
  const active = Math.min(highlight, Math.max(0, options.length - 1));

  function type(next: string) {
    setText(next);
    setOpen(true);
    setHighlight(0);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(next.trim()), 250);
  }

  function choose(option: Option) {
    onChange([
      ...value,
      option.kind === "text"
        ? { kind: "text", text: option.text }
        : { kind: "host", id: option.host.id, name: option.host.user.name, avatar_url: option.host.user.avatar_url },
    ]);
    type("");
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (options.length > 0) setHighlight((active + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && options[active]) choose(options[active]);
      else if (typed) choose({ kind: "text", text: typed });
    } else if (event.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 py-1 shadow-xs transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:min-h-9 dark:bg-input/30"
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

        {value.map((chip, index) => (
          <span
            key={chip.kind === "host" ? chip.id : `text-${chip.text}`}
            className={`flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-md pr-1 pl-1 text-xs font-medium ${
              chip.kind === "host" ? "bg-primary/10 text-brand" : "bg-secondary text-foreground"
            }`}
          >
            {chip.kind === "host" ? (
              <>
                <UserAvatar user={{ name: chip.name, avatar_url: chip.avatar_url }} size="w-4 h-4 text-[9px]" />
                <span className="truncate">{chip.name}</span>
              </>
            ) : (
              <span className="truncate pl-1">“{chip.text}”</span>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((_, at) => at !== index));
              }}
              aria-label={`Hapus ${chip.kind === "host" ? chip.name : chip.text}`}
              className="relative ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground after:absolute after:-inset-2.5 hover:bg-foreground/10 hover:text-foreground md:after:hidden"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={text}
          onChange={(event) => type(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          aria-label="Cari host"
          placeholder={value.length > 0 ? "Tambah host atau kata kunci…" : "Ketik nama/email atau pilih host (bisa lebih dari satu)…"}
          className="min-w-[12rem] flex-1 bg-transparent py-1 text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
        />

        {value.length > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange([]);
            }}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Hapus semua
          </button>
        )}
      </div>

      {open && (
        <ul id={listId} role="listbox" aria-multiselectable="true" className="absolute z-30 mt-1.5 max-h-80 w-full overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 duration-100">
          {options.map((option, index) => (
            <li
              key={option.kind === "text" ? "text" : option.host.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => {
                event.preventDefault(); // keep focus in the input
                choose(option);
              }}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 ${index === active ? "bg-muted" : ""}`}
            >
              {option.kind === "text" ? (
                <>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground" aria-hidden="true">
                    <Search className="size-3.5" />
                  </span>
                  <span className="min-w-0 text-sm">
                    <span className="text-foreground">Cari “{option.text}”</span>
                    <span className="block text-xs text-muted-foreground">Semua host yang nama atau emailnya memuat teks ini</span>
                  </span>
                </>
              ) : (
                <>
                  <UserAvatar user={option.host.user} size="w-7 h-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground truncate">{option.host.user.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">{option.host.user.email}</span>
                  </span>
                  <span className="hidden sm:flex flex-wrap justify-end gap-1">
                    {option.host.assignments
                      .filter((assignment) => assignment.status === "active")
                      .map((assignment) => (
                        <span key={assignment.id} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-body">
                          {assignment.brand.name}
                        </span>
                      ))}
                  </span>
                </>
              )}
            </li>
          ))}

          {suggestions.loading && !suggestions.data && <li className="px-3 py-2 text-sm text-muted-foreground">Memuat host…</li>}
          {suggestions.data && hosts.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">{typed ? "Tidak ada host dengan nama/email itu." : "Semua host sudah dipilih."}</li>
          )}
          {suggestions.data && suggestions.data.total > suggestions.data.data.length && (
            <li className="px-3 py-1.5 text-xs text-faint">
              Menampilkan {suggestions.data.data.length} dari {suggestions.data.total} host. Ketik untuk mempersempit.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
