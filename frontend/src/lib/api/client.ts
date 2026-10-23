/**
 * Requests to the Laravel backend: auth token, JSON or file bodies, errors, and the helpers
 * every area file uses (`post`/`put`/`del`, `query`).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface FetchOptions extends RequestInit {
  token?: string;
  /** Give up after this many ms (default 30 s; longer for file downloads). */
  timeout?: number;
  /**
   * false: this change doesn't alter what other pages show (marking a notification read, a Discord
   * test message), so the cached pages stay fresh. See `onDataChanged`.
   */
  invalidates?: boolean;
}

const TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 120_000;

let ambientSignal: AbortSignal | undefined;

/**
 * Run `start` with `signal` attached to the requests it sends right away (before its first await),
 * e.g. so a page's requests stop when the page is left. `useApiData` wraps its loaders in this.
 */
export function withSignal<T>(signal: AbortSignal, start: () => T): T {
  const previous = ambientSignal;
  ambientSignal = signal;
  try {
    return start();
  } finally {
    ambientSignal = previous;
  }
}

/** The caller's signal (if any) plus a timeout, so a hanging server can't keep a spinner going forever. */
function requestSignal(signal: AbortSignal | null | undefined, timeout: number): AbortSignal {
  const timer = AbortSignal.timeout(timeout);
  return signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timer]) : signal ?? timer;
}

/** Laravel's own English messages (and model class names): not for users' eyes. */
const FRAMEWORK_MESSAGE =
  /^(No query results for model|The route .+ could not be found|This action is unauthorized|Unauthenticated|Too Many Attempts|Server Error|Not Found|Forbidden|Method Not Allowed|Service Unavailable|The \w+ method is not supported|CSRF token mismatch)/i;

/** What to tell the user about a failed request: the server's own message when the app wrote it. */
function messageFor(status: number, message: string | undefined): string {
  // 500 can carry the exception text (APP_DEBUG); a deliberate 503 has its own message
  if (status === 500 || (status > 500 && (!message || FRAMEWORK_MESSAGE.test(message)))) return "Terjadi kesalahan di server. Coba lagi nanti.";
  if (message && !FRAMEWORK_MESSAGE.test(message)) return message;
  if (status === 401) return "Sesi kamu sudah berakhir. Silakan masuk lagi.";
  if (status === 403) return "Kamu tidak punya akses untuk ini.";
  if (status === 404) return "Data tidak ditemukan atau sudah dihapus.";
  if (status === 413) return "File terlalu besar.";
  if (status === 429) return "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.";
  return "Permintaan ke server gagal.";
}

let changeListener: (() => void) | null = null;

/**
 * Be told after every request that changed something on the server (any successful
 * non-GET), e.g. so cached lists on other pages load again next time they're opened.
 */
export function onDataChanged(listener: (() => void) | null) {
  changeListener = listener;
}

/**
 * Why a signed-in request was refused for the session as a whole: the token is gone (logged out,
 * password reset, account deactivated/archived) or an admin must set up 2FA again.
 */
export type SessionProblem = { reason: "signed-out" | "two-factor"; token: string; message: string };

let sessionListener: ((problem: SessionProblem) => void) | null = null;

/** Be told when a signed-in request shows the session can't be used anymore (see `SessionProblem`). Returns the unsubscribe. */
export function onSessionProblem(listener: (problem: SessionProblem) => void): () => void {
  sessionListener = listener;
  return () => {
    if (sessionListener === listener) sessionListener = null;
  };
}

/** 401: token unknown or revoked. 403 with `code`/`status`: the auth middleware refusing the user, not one action. */
function sessionProblem(status: number, error: { message?: string; code?: string; status?: string }): SessionProblem["reason"] | null {
  if (status === 401) return "signed-out";
  if (status === 403 && error.code === "two_factor_setup_required") return "two-factor";
  if (status === 403 && typeof error.status === "string" && error.status !== "active") return "signed-out";
  return null;
}

/**
 * Send a request to the Laravel backend with auth token injection.
 * FormData bodies (file uploads) are sent as multipart; everything else as JSON.
 */

async function request(endpoint: string, options: FetchOptions = {}): Promise<Response> {
  const { token, headers, timeout = TIMEOUT_MS, signal, invalidates = true, ...rest } = options;

  const defaultHeaders: Record<string, string> = {
    Accept: "application/json",
  };

  if (!(rest.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  if (token) {
    defaultHeaders["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      ...defaultHeaders,
      ...headers,
    },
    ...rest,
    signal: requestSignal(signal ?? ambientSignal, timeout),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = messageFor(response.status, error.message);
    const problem = token ? sessionProblem(response.status, error) : null;
    if (problem && token) sessionListener?.({ reason: problem, token, message });
    throw new ApiError(response.status, message, error);
  }

  const method = (rest.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && invalidates) changeListener?.();

  return response;
}

/** JSON API call. */
export async function api<T = unknown>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  return (await request(endpoint, options)).json();
}

/** Download a protected file (e.g. a KTP photo) as an object URL for <img src>. */
export async function apiFileUrl(endpoint: string, token: string): Promise<string> {
  return URL.createObjectURL(await (await request(endpoint, { token, timeout: FILE_TIMEOUT_MS })).blob());
}

/** Download a protected file (e.g. an Excel export) and save it as `fileName`. */
export async function downloadFile(endpoint: string, token: string, fileName: string): Promise<void> {
  saveObjectUrl(await apiFileUrl(endpoint, token), fileName);
}

/** Save something made in the browser (e.g. recovery codes) as a file. */
export function saveBlob(blob: Blob, fileName: string) {
  saveObjectUrl(URL.createObjectURL(blob), fileName);
}

/**
 * Show a downloaded file (object URL) in a tab opened during the click (popup blockers). The URL is
 * released after a minute: the tab has loaded it by then, and the page doesn't keep every file in memory.
 */
export function showInTab(tab: Window, url: string) {
  tab.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveObjectUrl(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Some browsers start the download after click() returns: revoking right away can cancel it
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Custom error class for API errors.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** First Laravel validation message per field, e.g. { email: "The email field is required." } */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};

  const errors = (error.data?.errors ?? {}) as Record<string, string[]>;
  return Object.fromEntries(Object.entries(errors).map(([field, messages]) => [field, messages[0]]));
}

/**
 * A failed request, split for a form: `fields` holds Laravel's per-field messages, and `message` what the
 * form should say on top: the server's message when no field is to blame, or the first validation
 * message for a key the form doesn't show next to a field (`shown` says which keys it does), so a
 * failed save is never silent. `message` is null when the fields say it all.
 */
export function splitApiError(error: unknown, shown: (key: string) => boolean = () => true): { fields: Record<string, string>; message: string | null } {
  const fields = fieldErrors(error);
  const keys = Object.keys(fields);
  if (keys.length === 0) return { fields, message: errorMessage(error) };
  const hidden = keys.find((key) => !shown(key));
  return { fields, message: hidden ? fields[hidden] : null };
}

/** For `splitApiError`: shown when the key (or its base, `ranges.0.start` → `ranges`) is one of `keys`. */
export function shownKeys(...keys: string[]): (key: string) => boolean {
  return (key) => keys.includes(key) || keys.includes(key.split(".")[0]);
}

/** The request gave up waiting (see `timeout`). */
export function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

/** A message to show the user for any failed request. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (isTimeout(error)) return "Server terlalu lama menjawab. Coba lagi sebentar lagi.";
  return "Tidak bisa terhubung ke server. Periksa koneksi internet kamu.";
}

/** What most changes answer with, e.g. { message: "Brand disimpan" }. */
export interface Message {
  message: string;
}

/** One page of a Laravel paginated list. */
export interface Paginated<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

/**
 * Calls that change something, signed in: `post(url, token, body?, options?)`. A FormData body goes as is
 * (uploads), anything else as JSON.
 */
function sender(method: "POST" | "PUT" | "DELETE") {
  return <T = Message>(endpoint: string, token: string, body?: unknown, options: Pick<FetchOptions, "invalidates"> = {}) =>
    api<T>(endpoint, { ...options, method, token, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
}

export const post = sender("POST");
export const put = sender("PUT");
export const del = sender("DELETE");

/**
 * "?a=1&b=x" from the values that are set ("", null and undefined are left out; arrays become `key[]=…`),
 * or "" when none are. Values are URL-encoded.
 */
export function query(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => search.append(`${key}[]`, String(item)));
    else if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
