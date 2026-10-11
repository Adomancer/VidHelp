/*
 * Class strings for raw form controls that don't go through TextField / SelectField
 * (inline editors, filters, textareas), so every control looks the same.
 */

const control =
  "w-full min-w-0 rounded-lg border border-input bg-card text-foreground shadow-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

/** Text, number, date and time inputs. */
export const inputClass = `${control} h-10 px-3 text-base md:h-9 md:text-sm`;

/** Compact inputs inside tables and inline rows. */
export const inputSmClass = `${control} h-9 px-2.5 text-sm md:h-8`;

/** Native selects; render them through NativeSelect for the chevron. */
export const selectClass = `${control} h-10 appearance-none pr-9 pl-3 text-base md:h-9 md:text-sm`;

export const selectSmClass = `${control} h-9 appearance-none pr-8 pl-2.5 text-sm md:h-8`;

export const textareaClass = `${control} min-h-20 px-3 py-2 text-base md:text-sm`;
