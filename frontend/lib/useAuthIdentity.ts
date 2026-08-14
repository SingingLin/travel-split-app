"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { getGuestName, getGuestToken } from "./authToken";

/** Which of this project's two login mechanisms is currently active in this
 * browser tab — used by components/UserMenu.tsx (identity display + logout)
 * and components/GuestBanner.tsx (the "登入 Google 帳號" prompt, only shown
 * for "guest"). "loading" covers both NextAuth's own async session
 * resolution AND the one-tick delay before this hook can safely read
 * localStorage client-side (see `mounted` below — reading it during SSR/the
 * first client render would mismatch the server-rendered markup).
 *
 * `guest.name` is this guest's current display name (see
 * lib/authToken.ts getGuestName's docstring for how it's kept in sync with
 * the backend) — falls back to "訪客" if it's somehow missing (e.g. a guest
 * token from before this name-caching existed). */
export type AuthIdentity =
  | { kind: "loading" }
  | { kind: "google"; name: string; image: string | null }
  | { kind: "guest"; name: string }
  | { kind: "none" };

export function useAuthIdentity(): AuthIdentity {
  const { data: session, status } = useSession();
  // Avoids a hydration mismatch: localStorage (read by getGuestToken) isn't
  // available during server rendering, so the very first client render must
  // still render the server's "nothing yet" output before this flips true.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate "flip once mounted client-side" flag, only way to avoid a localStorage-driven SSR/client hydration mismatch (see comment above)
  useEffect(() => setMounted(true), []);

  if (!mounted || status === "loading") return { kind: "loading" };
  if (session?.user) {
    return {
      kind: "google",
      name: session.user.name || session.user.email || "使用者",
      image: session.user.image ?? null,
    };
  }
  const guestToken = getGuestToken();
  if (guestToken) return { kind: "guest", name: getGuestName() || "訪客" };
  return { kind: "none" };
}
