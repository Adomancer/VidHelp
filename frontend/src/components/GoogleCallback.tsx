"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ApiError, authApi, type AuthUser } from "@/lib/api";
import { consumeOAuthState, homePathFor } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useSignIn } from "./AuthProvider";
import FormAlert from "./FormAlert";
import TwoFactorChallengeForm from "./TwoFactorChallengeForm";

type Outcome =
  | { kind: "signed-in"; token: string; user: AuthUser }
  | { kind: "pending"; message: string }
  | { kind: "two-factor"; challengeToken: string }
  | { kind: "error"; message: string };

/**
 * Verify `state` and exchange the Google `code` with the backend for a token.
 */
async function finishGoogleLogin(params: URLSearchParams): Promise<Outcome> {
  const code = params.get("code");
  const state = params.get("state");

  if (params.get("error") || !code) {
    return { kind: "error", message: "Masuk dengan Google dibatalkan." };
  }
  if (!state || !consumeOAuthState(state)) {
    return { kind: "error", message: "Link masuk ini sudah kedaluwarsa. Silakan coba lagi." };
  }

  try {
    const response = await authApi.googleCallback(code, state);

    if ("two_factor" in response) {
      return { kind: "two-factor", challengeToken: response.challenge_token };
    }
    if (!("token" in response)) {
      return { kind: "pending", message: response.message };
    }

    return { kind: "signed-in", token: response.token, user: response.user };
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
  const signIn = useSignIn();
  const searchParams = useSearchParams();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const started = useRef(false); // an auth code can only be exchanged once (StrictMode runs effects twice)

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    finishGoogleLogin(new URLSearchParams(searchParams.toString())).then((result) => {
      if (result.kind === "signed-in") {
        signIn(result.token, result.user);
        router.replace(homePathFor(result.user));
      } else {
        setOutcome(result);
      }
    });
  }, [router, searchParams, signIn]);

  if (!outcome || outcome.kind === "signed-in") {
    return (
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Sedang masuk…
      </p>
    );
  }

  if (outcome.kind === "two-factor") {
    return <TwoFactorChallengeForm challengeToken={outcome.challengeToken} onRestart={() => router.replace("/login")} />;
  }

  return (
    <div className="space-y-4">
      <FormAlert tone={outcome.kind === "pending" ? "warning" : "error"}>{outcome.message}</FormAlert>
      <Button asChild variant="outline" className="w-full">
        <Link href="/login">Kembali ke halaman masuk</Link>
      </Button>
    </div>
  );
}
