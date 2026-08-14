"use client";

import { useEffect } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { getGuestToken, setBackendToken } from "@/lib/authToken";
import GuestLinkHandler from "@/components/GuestLinkHandler";

/**
 * Keeps lib/authToken.ts's module-level `currentBackendToken` in sync with
 * whichever "am I logged in" mechanism is currently active, so lib/api.ts's
 * `request()` (a plain function outside React) can always read the latest
 * token. Must live inside <SessionProvider> to call useSession(); split out
 * from SessionProviderWrapper itself only because useSession() needs to be a
 * descendant of the provider it's paired with here, not a sibling.
 *
 * Precedence: a real NextAuth session (Google login) always wins once one
 * exists. Only when there is NO NextAuth session — and NextAuth has finished
 * resolving that (`status !== "loading"`), not just momentarily empty during
 * its own startup fetch — does this fall back to the guest-mode token
 * app/login/page.tsx's "略過登入，先用訪客身分開始" button stashed in
 * localStorage (see lib/authToken.ts getGuestToken). This is what lets a
 * guest's already-in-flight requests keep working after a reload, and lets
 * a user who links their guest session to a real Google account (see
 * components/GuestLinkHandler.tsx) transparently switch over to the
 * Google-backed token the moment NextAuth's session picks it up.
 */
function BackendTokenSync() {
  const { data: session, status } = useSession();
  useEffect(() => {
    if (session?.backendToken) {
      setBackendToken(session.backendToken);
      return;
    }
    if (status === "loading") return; // still resolving — don't prematurely fall back
    setBackendToken(getGuestToken());
  }, [session?.backendToken, status]);
  return null;
}

/**
 * Client-component wrapper around NextAuth's SessionProvider — same pattern
 * this project already uses for ToastProvider (see lib/ToastContext.tsx):
 * app/layout.tsx is a server component, but SessionProvider (and the
 * useSession() hook it powers) must run client-side, so this thin wrapper is
 * what actually gets mounted in the tree.
 *
 * `session` is passed down from app/layout.tsx's server-side `auth()` call
 * (not fetched here) specifically to avoid a race: every page under this
 * layout is already guaranteed to have a valid NextAuth session by the time
 * it renders (middleware.ts enforces that), but SessionProvider still does
 * its OWN async client-side fetch to /api/auth/session on mount unless
 * seeded with an initial value — and pages like app/page.tsx fire their own
 * backend API calls (e.g. listTrips()) in a `useEffect` on mount too, with
 * no guarantee that runs after the session fetch resolves. Losing that race
 * means lib/api.ts's request() sees no Authorization header yet, the
 * backend 401s, and request() hard-redirects to /login — logging out a
 * user who was, in fact, logged in the whole time. Seeding `session` here
 * makes useSession() synchronously correct on first render, no fetch
 * needed, no race.
 */
export default function SessionProviderWrapper({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      <BackendTokenSync />
      <GuestLinkHandler />
      {children}
    </SessionProvider>
  );
}
