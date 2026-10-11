/**
 * Requests to the Laravel backend: auth token, JSON or file bodies, errors, and the helpers
 * every area file uses (`post`/`put`/`del`, `query`).
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

interface FetchOptions extends RequestInit {
  token?: string;
}

/**
 * Send a request to the Laravel backend with auth token injection.
 * FormData bodies (file uploads) are sent as multipart; everything else as JSON.
 */

async function request(endpoint: string, options: FetchOptions = {}): Promise<Response> {
  const { token, headers, ...rest } = options;

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
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(response.status, error.message || "Permintaan ke server gagal", error);
  }

  return response;
}

/** JSON API call. */
export async function api<T = unknown>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  return (await request(endpoint, options)).json();
}

/** Download a protected file (e.g. a KTP photo) as an object URL for <img src>. */
export async function apiFileUrl(endpoint: string, token: string): Promise<string> {
  return URL.createObjectURL(await (await request(endpoint, { token })).blob());
}

/** Download a protected file (e.g. an Excel export) and save it as `fileName`. */
export async function downloadFile(endpoint: string, token: string, fileName: string): Promise<void> {
  const url = await apiFileUrl(endpoint, token);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
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

/** A message to show the user for any failed request. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Tidak bisa terhubung ke server. Apakah backend sudah berjalan?";
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
  total: number;
}

/** Calls that change something, signed in: `post(url, token, body?)`. A FormData body goes as is (uploads), anything else as JSON. */
function sender(method: "POST" | "PUT" | "DELETE") {
  return <T = Message>(endpoint: string, token: string, body?: unknown) =>
    api<T>(endpoint, { method, token, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
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
