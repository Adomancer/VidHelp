"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, authApi } from "@/lib/api";
import { consumeOAuthState, homePathFor, saveSession } from "@/lib/auth";

type Outcome =
  | { kind: "signed-in"; path: string }
  | { kind: "pending"; message: string }
  | { kind: "error"; message: string };

/**
 * Verify `state`, exchange the Google `code` with the backend and store the token.
 */
async function finishGoogleLogin(params: URLSearchParams): Promise<Outcome> {
  const code = params.get("code");

  if (params.get("error") || !code) {
    return { kind: "error", message: "Google sign-in was cancelled." };
  }
  if (!consumeOAuthState(params.get("state"))) {
    return { kind: "error", message: "This sign-in link has expired. Please try again." };
  }

  try {
    const response = await authApi.googleCallback(code);

    if (!("token" in response)) {
      return { kind: "pending", message: response.message };
    }

    saveSession(response.token, response.user);
    return { kind: "signed-in", path: homePathFor(response.user) };
  } catch (error) {
    if (error instanceof ApiError && error.data?.status === "pending") {
      return { kind: "pending", message: error.message };
    }
    return {
      kind: "error",
      message: error instanceof ApiError ? error.message : "Could not reach the server.",
    };
  }
}

/**
 * Landing page for Google's redirect back to the frontend.
 */
export default function GoogleCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const started = useRef(false); // an auth code can only be exchanged once (StrictMode runs effects twice)

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    finishGoogleLogin(new URLSearchParams(searchParams.toString())).then((result) => {
      if (result.kind === "signed-in") {
        router.replace(result.path);
      } else {
        setOutcome(result);
      }
    });
  }, [router, searchParams]);

  if (!outcome || outcome.kind === "signed-in") {
    return <p className="text-center text-gray-300">Signing you in…</p>;
  }

  return (
    <div className="space-y-4 text-center">
      <p className={outcome.kind === "pending" ? "text-yellow-200" : "text-red-300"}>{outcome.message}</p>
      <Link href="/login" className="inline-block text-sm text-purple-300 hover:text-white">
        Back to login
      </Link>
    </div>
  );
}
