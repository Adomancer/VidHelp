"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { discordApi, errorMessage } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import { DISCORD_STATE_KEY } from "@/components/DiscordConnect";
import FormAlert from "@/components/FormAlert";
import { Button } from "@/components/ui/button";

/** Discord redirects here after "Connect Discord"; finish linking, then back to the profile. */
export default function DiscordCallbackPage() {
  return (
    <div className="mx-auto max-w-lg pt-10">
      {/* useSearchParams needs a Suspense boundary */}
      <Suspense fallback={<Connecting />}>
        <FinishLink />
      </Suspense>
    </div>
  );
}

async function finish(token: string, params: URLSearchParams): Promise<string | null> {
  const expected = sessionStorage.getItem(DISCORD_STATE_KEY);
  sessionStorage.removeItem(DISCORD_STATE_KEY);

  const code = params.get("code");
  if (params.get("error") || !code) return "Menghubungkan Discord dibatalkan.";
  if (!expected || expected !== params.get("state")) return "Link ini sudah kedaluwarsa. Silakan coba lagi dari profil kamu.";

  try {
    await discordApi.link(token, code);
    return null;
  } catch (caught) {
    return errorMessage(caught);
  }
}

function FinishLink() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false); // a Discord code can only be used once (StrictMode runs effects twice)

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    finish(token, new URLSearchParams(searchParams.toString())).then((problem) => {
      if (problem) setError(problem);
      else router.replace("/host/profile");
    });
  }, [router, searchParams, token]);

  if (!error) return <Connecting />;

  return (
    <Card>
      <FormAlert tone="error">{error}</FormAlert>
      <Button asChild variant="outline">
        <Link href="/host/profile">Kembali ke profil saya</Link>
      </Button>
    </Card>
  );
}

function Connecting() {
  return (
    <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Menghubungkan Discord…
    </p>
  );
}
