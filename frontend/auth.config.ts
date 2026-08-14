import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the NextAuth config — deliberately has NO providers and
 * NO `jsonwebtoken`-based callbacks (that package needs Node's `crypto`
 * module, which isn't available in the Edge runtime `middleware.ts` runs
 * in). `auth.ts` imports this and adds the Google provider + the
 * backend-JWT-signing callbacks on top for the actual sign-in flow (which
 * runs in the Node.js runtime, via the `app/api/auth/[...nextauth]` route
 * handler). Splitting it this way is the officially recommended NextAuth v5
 * pattern for using `auth()` inside `middleware.ts`.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    /**
     * Runs on every request middleware.ts covers. `auth` is NextAuth's own
     * session (present once cookie-verified), independent of this app's
     * separate `backendToken`. Public paths (the login page itself,
     * NextAuth's own `/api/auth/*` routes it needs to complete sign-in, and
     * — new this round — `/join/*`) always pass; everything else requires
     * EITHER a real NextAuth session OR the plain `has_session=1` cookie set
     * by app/login/page.tsx's guest login flow (see frontend/lib/
     * authToken.ts markHasSessionCookie) — a guest never gets a NextAuth
     * session at all (no Google OAuth involved), so without this OR,
     * middleware would bounce every guest straight back to /login right
     * after they picked "略過登入，先用訪客身分開始".
     * That cookie deliberately carries no real token/secret, just a boolean
     * signal this Edge-runtime callback can read (it can't reach
     * localStorage, where the actual guest JWT lives) — see lib/api.ts's
     * request() for where the real token gets attached to actual API calls.
     *
     * `/join/[code]` is public so a brand-new, not-yet-logged-in visitor can
     * land on it straight from a shared invite link and see the
     * unauthenticated GET /api/trips/join/preview result ("你要加入『{行程
     * 名稱}』") BEFORE choosing Google login or guest mode — see
     * app/join/[code]/page.tsx. The page itself still requires the visitor
     * to actually log in (Google) or create/recover a guest identity before
     * it calls the real POST /api/trips/join, so this doesn't weaken access
     * control — it only lets the PREVIEW render without first forcing a
     * redirect to /login.
     *
     * Returning `false` here makes NextAuth's middleware wrapper redirect to
     * `pages.signIn` with a `callbackUrl` query param pointing back at the
     * page the user was trying to reach — see middleware.ts.
     */
    authorized({ auth, request: { nextUrl, cookies } }) {
      const isLoggedIn = !!auth?.user;
      const hasGuestSession = cookies.get("has_session")?.value === "1";
      const isPublicPath =
        nextUrl.pathname === "/login" ||
        nextUrl.pathname.startsWith("/api/auth") ||
        nextUrl.pathname.startsWith("/join/");
      if (isPublicPath) return true;
      return isLoggedIn || hasGuestSession;
    },
  },
} satisfies NextAuthConfig;
