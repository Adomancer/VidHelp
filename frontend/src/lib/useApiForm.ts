"use client";

import { useState, type FormEvent } from "react";
import { splitApiError } from "./api";

/**
 * True if the form shows the validation error for `key` next to a field: a named control in the form
 * (`ranges.0.start` matches `ranges`, `ranges[]`, `ranges[0][start]`…), or one of `shown` (errors the
 * form renders for a control without a name, e.g. a date picker kept in state).
 */
function shownInForm(form: HTMLFormElement, key: string, shown: readonly string[]): boolean {
  const base = key.split(".")[0];
  if (shown.some((field) => key === field || base === field)) return true;
  return Array.from(form.elements).some((element) => {
    const name = (element as HTMLInputElement).name;
    return Boolean(name) && (name === key || name === base || name.startsWith(`${base}[`));
  });
}

/**
 * Submit handler for forms backed by one API call.
 * Laravel validation errors land in `errors` (per field); anything else in `error`. A validation error the
 * form has no field for (e.g. `changes`: "Tidak ada perubahan…", or `period`: "Periode ini terkunci") also
 * goes to `error`, so a failed submit never ends without a message. `shown` lists error keys the form
 * renders for controls that have no `name`.
 */
export function useApiForm<T>(
  submit: (data: FormData) => Promise<T>,
  onSuccess: (result: T, form: HTMLFormElement) => void,
  shown: readonly string[] = []
) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    setLoading(true);
    setErrors({});
    setError(null);

    try {
      onSuccess(await submit(new FormData(form)), form);
    } catch (caught) {
      const { fields, message } = splitApiError(caught, (key) => shownInForm(form, key, shown));
      setErrors(fields);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return { loading, errors, error, handleSubmit };
}

/** Read a text field from FormData. */
export function formValue(data: FormData, name: string): string {
  return String(data.get(name) ?? "");
}
