import { errorMessage } from "@/lib/api";

export interface BulkItemResult<T> {
  item: T;
  label: string;
  ok: boolean;
  error?: string;
}

export interface BulkRunSummary<T> {
  succeeded: BulkItemResult<T>[];
  failed: BulkItemResult<T>[];
  total: number;
}

export const DEFAULT_BULK_CONCURRENCY = 3;
export const MAX_BULK_CONCURRENCY = 5;

/**
 * Executes an async per-item worker across `items` with bounded concurrency (clamped to 1..5).
 * Collects per-item success and error states so partial failures can be reviewed and retried.
 */
export async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  options?: {
    concurrency?: number;
    getLabel?: (item: T) => string;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<BulkRunSummary<T>> {
  const total = items.length;
  const limit = Math.min(MAX_BULK_CONCURRENCY, Math.max(1, Math.floor(options?.concurrency ?? DEFAULT_BULK_CONCURRENCY)));
  const results: BulkItemResult<T>[] = new Array(total);
  let nextIndex = 0;
  let done = 0;

  async function runWorker() {
    while (nextIndex < total) {
      const current = nextIndex++;
      const item = items[current];
      const label = options?.getLabel?.(item) ?? `Item #${current + 1}`;
      try {
        await worker(item);
        results[current] = { item, label, ok: true };
      } catch (caught) {
        results[current] = { item, label, ok: false, error: errorMessage(caught) };
      } finally {
        done += 1;
        options?.onProgress?.(done, total);
      }
    }
  }

  const workerCount = Math.min(limit, total);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const succeeded = results.filter((entry) => entry.ok);
  const failed = results.filter((entry) => !entry.ok);
  return { succeeded, failed, total };
}
