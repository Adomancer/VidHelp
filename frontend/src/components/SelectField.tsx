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
      <label htmlFor={name} className="block text-sm font-medium text-body">
        {label}
      </label>
      <select
        id={name}
        name={name}
        className={`w-full px-4 py-2.5 rounded-lg bg-transparent dark:bg-surface-2 border-[1.5px] text-heading outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${
          error ? "border-red-500" : "border-stroke-strong"
        }`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
