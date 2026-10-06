import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
}

/** Labelled input that shows its validation error underneath. */
export default function TextField({ label, name, error, className = "", ...props }: TextFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-body">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        className={`w-full px-4 py-2.5 rounded-lg bg-transparent dark:bg-surface-2 border-[1.5px] text-heading placeholder-faint outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${
          error ? "border-red-500" : "border-stroke-strong"
        } ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
