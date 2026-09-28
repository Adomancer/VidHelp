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
      <label htmlFor={name} className="block text-sm font-medium text-gray-200">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        className={`w-full px-4 py-2.5 rounded-xl bg-slate-900/60 border text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-purple-500 ${
          error ? "border-red-400" : "border-white/15"
        } ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
