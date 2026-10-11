"use client";

import type { AuthUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthProvider";

interface UserAvatarProps {
  /** Defaults to the signed-in user. */
  user?: Pick<AuthUser, "name" | "avatar_url">;
  size?: string;
}

/** Profile photo if there is one, otherwise the user's initial. */
export default function UserAvatar({ user, size = "w-8 h-8" }: UserAvatarProps) {
  const { user: me } = useAuth();
  const shown = user ?? me;

  if (shown.avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element -- Google or backend-hosted photo, no next/image config needed
    return <img src={shown.avatar_url} alt="" referrerPolicy="no-referrer" className={cn("shrink-0 rounded-full object-cover ring-1 ring-foreground/10", size)} />;
  }

  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-brand", size)}>
      {shown.name.charAt(0).toUpperCase()}
    </span>
  );
}
