"use client";

import { useState, type FormEvent } from "react";
import { errorMessage, fieldErrors } from "./api";

/**
 * Submit handler for forms backed by one API call.
 * Laravel validation errors land in `errors` (per field); anything else in `error`.
 */
export function useApiForm<T>(
  submit: (data: FormData) => Promise<T>,
  onSuccess: (result: T, form: HTMLFormElement) => void
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
      const fields = fieldErrors(caught);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setError(errorMessage(caught));
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
