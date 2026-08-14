import { handlers } from "@/auth";

// NextAuth v5's catch-all route handler — handles every /api/auth/* request
// (sign-in redirect to Google, the OAuth callback, sign-out, session probe,
// etc). Runs in the Node.js runtime (Next.js route handlers default to
// Node.js, not Edge), which is required here since auth.ts's callbacks.jwt
// uses the `jsonwebtoken` package (needs Node's `crypto`) — unlike
// middleware.ts, which only imports the Edge-safe auth.config.ts.
export const { GET, POST } = handlers;
