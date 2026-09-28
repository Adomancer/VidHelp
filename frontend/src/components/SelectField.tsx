import type { SelectHTMLAttributes } from "react";

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  name: string;
  error?: string;
  options: { value: string; label: string }[];
}

/** Labelled select that shows its validation error underneath. */
export default function SelectField({ label, name, error, options, ...props }: SelectFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-gray-200">
        {label}
      </label>
      <select
        id={name}
        name={name}
        className={`w-full px-4 py-2.5 rounded-xl bg-slate-900/60 border text-white outline-none focus:ring-2 focus:ring-purple-500 ${
          error ? "border-red-400" : "border-white/15"
        }`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
