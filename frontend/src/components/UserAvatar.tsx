"use client";

import type { AuthUser } from "@/lib/api";
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
    return <img src={shown.avatar_url} alt="" referrerPolicy="no-referrer" className={`${size} rounded-full object-cover shrink-0`} />;
  }

  return (
    <span className={`${size} shrink-0 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold`}>
      {shown.name.charAt(0).toUpperCase()}
    </span>
  );
}
