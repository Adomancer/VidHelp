"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, authApi } from "@/lib/api";
import { consumeOAuthState, homePathFor, saveSession } from "@/lib/auth";
import TwoFactorChallengeForm from "./TwoFactorChallengeForm";

type Outcome =
  | { kind: "signed-in"; path: string }
  | { kind: "pending"; message: string }
  | { kind: "two-factor"; challengeToken: string }
  | { kind: "error"; message: string };

/**
 * Verify `state`, exchange the Google `code` with the backend and store the token.
 */
async function finishGoogleLogin(params: URLSearchParams): Promise<Outcome> {
  const code = params.get("code");

  if (params.get("error") || !code) {
    return { kind: "error", message: "Masuk dengan Google dibatalkan." };
  }
  if (!consumeOAuthState(params.get("state"))) {
    return { kind: "error", message: "Link masuk ini sudah kedaluwarsa. Silakan coba lagi." };
  }

  try {
    const response = await authApi.googleCallback(code);

    if ("two_factor" in response) {
      return { kind: "two-factor", challengeToken: response.challenge_token };
    }
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
      message: error instanceof ApiError ? error.message : "Tidak bisa terhubung ke server.",
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
    return <p className="text-center text-body">Sedang masuk…</p>;
  }

  if (outcome.kind === "two-factor") {
    return <TwoFactorChallengeForm challengeToken={outcome.challengeToken} onRestart={() => router.replace("/login")} />;
  }

  return (
    <div className="space-y-4 text-center">
      <p className={outcome.kind === "pending" ? "text-warning" : "text-danger"}>{outcome.message}</p>
      <Link href="/login" className="inline-block text-sm text-accent hover:text-heading">
        Kembali ke halaman masuk
      </Link>
    </div>
  );
}
