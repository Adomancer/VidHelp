import { NextResponse, type NextRequest } from "next/server";

const API_ORIGIN = new URL(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api").origin;

/**
 * Content-Security-Policy with a fresh nonce per page view. Next.js reads the nonce from the request
 * header and puts it on its own scripts; the root layout puts it on the theme script.
 *
 * Scripts only run when they carry the nonce, so injected HTML (e.g. a sanitizer bypass in product
 * knowledge) can't run code, and `connect-src` keeps a stolen token from being sent anywhere but the API.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";

  return [
    "default-src 'self'",
    // React needs eval in development only (readable server error stacks)
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Radix and the charts set inline style attributes, which a nonce can't cover
    "style-src 'self' 'unsafe-inline'",
    // Protected files are shown as blob: URLs; avatars come from the backend storage or Google
    `img-src 'self' blob: data: ${API_ORIGIN} https://*.googleusercontent.com`,
    "font-src 'self' data:",
    `connect-src 'self' ${API_ORIGIN}${dev ? " ws: wss:" : ""}`,
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(API_ORIGIN.startsWith("https:") ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not static files, and not link prefetches (they carry no HTML)
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
