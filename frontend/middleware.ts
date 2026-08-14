import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Deliberately built from the Edge-safe `authConfig` (no Google provider, no
// `jsonwebtoken` callbacks) rather than importing `auth` from ./auth.ts —
// middleware always runs in the Edge runtime, which can't load
// `jsonwebtoken`'s Node `crypto` dependency. `authConfig.callbacks.authorized`
// (see auth.config.ts) is what actually decides "logged in or redirect to
// /login"; NextAuth's middleware wrapper below runs it on every matched
// request and, on `false`, redirects to `pages.signIn` with `callbackUrl`
// set to the original URL automatically.
const { auth } = NextAuth(authConfig);

export default auth;

// Protects every route except: NextAuth's own /api/auth/* endpoints (sign-in
// redirect, OAuth callback, sign-out, session probe — these must stay
// reachable while logged out, that's how login itself works), and Next.js's
// static/internal assets (_next/static, _next/image, favicon.ico, and any
// file with an extension e.g. icons/images under /public). /login itself is
// intentionally NOT excluded from the matcher — it still goes through
// `authorized()` above, which explicitly allow-lists it, so an already
// logged-in user hitting /login still gets NextAuth's normal handling
// (nothing forces a redirect loop either way).
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
