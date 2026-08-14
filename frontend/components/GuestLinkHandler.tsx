"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { clearGuestToken, clearHasSessionCookie, getGuestToken } from "@/lib/authToken";
import { linkGuest } from "@/lib/api";

/**
 * Fires POST /api/auth/link-guest the moment a real NextAuth (Google) session
 * appears while a guest-mode token is still sitting in localStorage — i.e.
 * right after a guest clicks "登入 Google 帳號" (see components/GuestBanner.tsx)
 * and completes the OAuth round trip. Must live inside <SessionProvider> (see
 * useSession() below); mounted alongside SessionProviderWrapper's
 * BackendTokenSync so lib/api.ts's request() already has the fresh Google
 * backendToken attached (not the stale guest one) by the time linkGuest()
 * actually fires — see that component's docstring for the precedence rule
 * this relies on.
 *
 * `attemptedRef` guards against calling link-guest more than once per mount
 * (e.g. a session object identity change that isn't a genuine new login) —
 * backend/app/routers/auth.py's link_guest is intentionally NOT idempotent
 * (a guest account can only ever be merged once), so a duplicate call would
 * just 400 harmlessly, but there's no reason to fire it twice.
 */
export default function GuestLinkHandler() {
  const { status } = useSession();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    const guestToken = getGuestToken();
    if (!guestToken || attemptedRef.current) return;
    attemptedRef.current = true;

    linkGuest(guestToken)
      .then(() => {
        clearGuestToken();
        clearHasSessionCookie();
        // Full reload is the simplest reliable way to make every
        // already-mounted page (trip list, trip detail, etc.) pick up the
        // now-merged trips — those pages fetch their own data in a
        // useEffect on mount, not via a shared client-side cache this
        // handler could otherwise just invalidate.
        window.location.reload();
      })
      .catch(() => {
        // Guest token invalid/expired/already-linked (see backend
        // POST /api/auth/link-guest docstring for the specific 400 cases) —
        // nothing to merge, and the user is fully logged in via Google
        // regardless, so just drop the stale guest token/cookie silently
        // rather than blocking anything or surfacing an error for a
        // best-effort background merge the user didn't directly trigger.
        clearGuestToken();
        clearHasSessionCookie();
      });
  }, [status]);

  return null;
}
