"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  const suggestions = useApiData(`host-suggest|${open}|${query}`, () =>
    open ? operatorApi.hosts(token, { search: query ? [query] : [], page: 1 }) : Promise.resolve(null)
  );

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
        className="flex flex-wrap items-center gap-1.5 min-h-[42px] w-full px-2.5 py-1.5 rounded-lg bg-surface border border-stroke cursor-text focus-within:ring-2 focus-within:ring-primary"
      >
        <svg className="w-4 h-4 shrink-0 text-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>

        {value.map((chip, index) => (
          <span
            key={chip.kind === "host" ? chip.id : `text-${chip.text}`}
            className={`flex items-center gap-1.5 rounded-md py-0.5 pl-1 pr-1.5 text-xs ${
              chip.kind === "host" ? "bg-primary/20 text-accent" : "bg-surface-3 text-heading"
            }`}
          >
            {chip.kind === "host" ? (
              <>
                <UserAvatar user={{ name: chip.name, avatar_url: chip.avatar_url }} size="w-4 h-4 text-[9px]" />
                {chip.name}
              </>
            ) : (
              <span className="pl-1">“{chip.text}”</span>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((_, at) => at !== index));
              }}
              aria-label={`Hapus ${chip.kind === "host" ? chip.name : chip.text}`}
              className="ml-0.5 text-muted hover:text-heading"
            >
              ✕
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
          className="flex-1 min-w-[12rem] bg-transparent py-1 text-heading placeholder-faint outline-none"
        />

        {value.length > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange([]);
            }}
            className="shrink-0 rounded-md px-2 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-heading"
          >
            Hapus semua
          </button>
        )}
      </div>

      {open && (
        <ul id={listId} role="listbox" aria-multiselectable="true" className="absolute z-30 mt-1 w-full max-h-80 overflow-y-auto rounded-lg border border-stroke-strong bg-surface-2 p-1 shadow-xl">
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
              className={`flex items-center gap-3 rounded-md px-2.5 py-2 cursor-pointer ${index === active ? "bg-surface-3" : ""}`}
            >
              {option.kind === "text" ? (
                <>
                  <span className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full bg-surface-3 text-body" aria-hidden="true">
                    🔍
                  </span>
                  <span className="min-w-0 text-sm">
                    <span className="text-heading">Cari “{option.text}”</span>
                    <span className="block text-xs text-muted">Semua host yang nama atau emailnya memuat teks ini</span>
                  </span>
                </>
              ) : (
                <>
                  <UserAvatar user={option.host.user} size="w-7 h-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-heading truncate">{option.host.user.name}</span>
                    <span className="block text-xs text-muted truncate">{option.host.user.email}</span>
                  </span>
                  <span className="hidden sm:flex flex-wrap justify-end gap-1">
                    {option.host.assignments
                      .filter((assignment) => assignment.status === "active")
                      .map((assignment) => (
                        <span key={assignment.id} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-body">
                          {assignment.brand.name}
                        </span>
                      ))}
                  </span>
                </>
              )}
            </li>
          ))}

          {suggestions.loading && !suggestions.data && <li className="px-3 py-2 text-sm text-muted">Memuat host…</li>}
          {suggestions.data && hosts.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">{typed ? "Tidak ada host dengan nama/email itu." : "Semua host sudah dipilih."}</li>
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
