// Module augmentation: adds `backendToken` to NextAuth's Session and JWT
// shapes. This is NOT NextAuth's own session — it's this project's
// custom-signed JWT (see backend/app/auth.py) that gets attached to
// NextAuth's token in auth.ts's `callbacks.jwt` and surfaced to client
// components via `useSession().data?.backendToken` (see
// components/SessionProviderWrapper.tsx). Kept in its own `types/` file
// (not colocated with auth.ts) purely so it's picked up automatically by
// tsconfig's `**/*.ts` include without needing an explicit import anywhere —
// TypeScript module augmentation files just need to be part of the program.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    /** HS256 JWT signed with APP_JWT_SECRET (see auth.ts), sent as
     * `Authorization: Bearer <backendToken>` on every call to this app's own
     * FastAPI backend — see lib/api.ts. Undefined until sign-in has actually
     * produced one (should never happen once session.user exists, but stays
     * optional so a partially-migrated/old session doesn't crash consumers). */
    backendToken?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    /** Same value as Session.backendToken above, stashed on NextAuth's own
     * encrypted JWT so callbacks.session can read it back out without
     * re-signing on every request. */
    backendToken?: string;
  }
}
