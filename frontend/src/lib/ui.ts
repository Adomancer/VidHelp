/*
 * Class strings for raw form controls that don't go through TextField / SelectField
 * (inline editors, filters, textareas), so every control looks the same.
 */

const control =
  "w-full min-w-0 rounded-lg border border-input bg-card text-foreground shadow-card transition-colors duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 dark:bg-input/25";

/** Text, number, date and time inputs. */
export const inputClass = `${control} h-11 px-3 text-base md:h-9 md:text-sm`;

/** Compact inputs inside tables and inline rows. */
export const inputSmClass = `${control} h-11 px-2.5 text-base md:h-8 md:text-sm`;

/** Native selects; render them through NativeSelect for the chevron. */
export const selectClass = `${control} h-11 appearance-none pr-9 pl-3 text-base md:h-9 md:text-sm`;

export const selectSmClass = `${control} h-11 appearance-none pr-8 pl-2.5 text-base md:h-8 md:text-sm`;

export const textareaClass = `${control} min-h-24 px-3 py-2.5 text-base md:min-h-20 md:py-2 md:text-sm`;
