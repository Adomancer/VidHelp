"use client";

import { Search, X } from "lucide-react";
import { inputClass } from "@/lib/ui";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
  "aria-label"?: string;
}

/** Search input with leading icon and an accessible clear button (44px touch target on mobile). */
export default function SearchInput({
  value,
  onChange,
  placeholder = "Cari…",
  id,
  name,
  disabled = false,
  autoFocus = false,
  className,
  inputClassName,
  "aria-label": ariaLabel,
}: SearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        id={id}
        name={name}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
        className={cn(inputClass, "pl-9 [&::-webkit-search-cancel-button]:hidden", value && !disabled && "pr-12 md:pr-9", inputClassName)}
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Hapus pencarian"
          className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 md:right-1 md:size-7"
        >
          <X className="size-4 md:size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
