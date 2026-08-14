import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import jwt from "jsonwebtoken";
import { authConfig } from "./auth.config";

/**
 * APP_JWT_SECRET vs NEXTAUTH_SECRET/AUTH_SECRET
 * ----------------------------------------------
 * Two unrelated secrets, easy to confuse:
 *  - NEXTAUTH_SECRET / AUTH_SECRET: NextAuth's OWN internal key, used to
 *    encrypt/sign the NextAuth session cookie/JWT it manages for itself.
 *    Never sent anywhere, never seen by the backend. Configured below only
 *    implicitly (NextAuth v5 auto-reads `process.env.AUTH_SECRET`, and in
 *    development generates a throwaway one with a console warning if unset
 *    — no explicit `secret:` option needed here).
 *  - APP_JWT_SECRET: THIS backend's signing key (see backend/app/auth.py)
 *    for the separate custom JWT this frontend mints on successful login
 *    and forwards as `Authorization: Bearer <token>` on every API call (see
 *    lib/api.ts). Must be byte-for-byte identical to the value configured on
 *    the Render backend, or every API call will 401. The fallback below is
 *    intentionally the exact same public, well-known dev placeholder string
 *    backend/app/auth.py falls back to, so local dev works out of the box
 *    with zero env setup on either side — production MUST override this.
 */
const APP_JWT_SECRET = process.env.APP_JWT_SECRET || "dev-insecure-secret-change-in-production";
const APP_JWT_ALGORITHM = "HS256";
const APP_JWT_EXPIRE_DAYS = 7; // matches backend/app/auth.py ACCESS_TOKEN_EXPIRE_DAYS

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Google({
      // Intentionally read straight from env with no local fallback — this
      // round only wires the code up to read GOOGLE_CLIENT_ID/SECRET; real
      // values get filled in on Vercel later (see README.md "部署到 Render
      // + Vercel"). Left undefined in local dev, the Google provider is
      // still constructable and the app still builds/runs; only clicking
      // "使用 Google 帳號登入" would actually fail without real credentials.
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    /**
     * `user` is only populated on the sign-in request itself (Google's
     * profile response) — every subsequent request just refreshes/reads the
     * existing `token`, so the backend JWT is signed exactly once per login
     * and then just carried forward on `token.backendToken` until the user
     * signs in again. Payload shape (`sub`/`email`/`name`) matches what
     * backend/app/auth.py's decode_access_token + get_current_user expect;
     * `sub` uses the email (the backend upserts a User row keyed on email
     * the first time it sees a given token, per that module's docstring).
     */
    async jwt({ token, user }) {
      if (user) {
        const email = user.email ?? (token.email as string | undefined);
        const name = user.name ?? (token.name as string | undefined) ?? email ?? "";
        // Google's profile picture URL (session.user.image) — only present
        // on this sign-in-time `user` object, same as email/name above, so
        // it's read here and folded into the ONE backend JWT signed per
        // login rather than needing a separate sync call. Omitted (not
        // sent as e.g. an empty string) when Google didn't supply one, so
        // backend/app/auth.py's `payload.get("avatar_url") or None` check
        // there stays a clean has-a-value/doesn't distinction.
        const avatarUrl = user.image ?? undefined;
        if (email) {
          const claims: Record<string, string> = { sub: email, email, name };
          if (avatarUrl) claims.avatar_url = avatarUrl;
          token.backendToken = jwt.sign(claims, APP_JWT_SECRET, {
            algorithm: APP_JWT_ALGORITHM,
            expiresIn: `${APP_JWT_EXPIRE_DAYS}d`,
          });
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.backendToken) {
        session.backendToken = token.backendToken;
      }
      return session;
    },
  },
});
