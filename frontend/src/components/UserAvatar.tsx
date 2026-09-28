"use client";

import { useAuth } from "./AuthProvider";

/** Google photo if we have one, otherwise the user's initial. */
export default function UserAvatar({ size = "w-8 h-8" }: { size?: string }) {
  const { user } = useAuth();

  if (user.avatar?.startsWith("http")) {
    // eslint-disable-next-line @next/next/no-img-element -- external Google avatar, no need for next/image config
    return <img src={user.avatar} alt="" referrerPolicy="no-referrer" className={`${size} rounded-full object-cover`} />;
  }

  return (
    <span className={`${size} rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold`}>
      {user.name.charAt(0).toUpperCase()}
    </span>
  );
}
