// Module-level bridge between NextAuth's React context (`useSession()`,
// only usable inside client components under <SessionProvider>) and
// lib/api.ts's `request()` — a plain function with no React context of its
// own. components/SessionProviderWrapper.tsx calls `setBackendToken()`
// inside a `useSession()` + `useEffect` every time the session changes;
// `request()` just reads `currentBackendToken` synchronously when it builds
// each fetch's headers. A plain module-level variable is enough here (not
// e.g. localStorage) since this only ever needs to be read within the same
// browser tab's JS runtime that NextAuth's session lives in — it's not
// meant to persist across reloads (session rehydration naturally re-syncs
// it on mount).
//
// Guest mode (see app/login/page.tsx "略過登入，先用訪客身分開始" and
// backend/app/routers/auth.py POST /api/auth/guest): a guest has no NextAuth
// session at all, so their backend JWT lives in localStorage instead (key
// GUEST_TOKEN_KEY below) — localStorage, unlike this module-level variable,
// survives page reloads, which a guest needs since there's no session cookie
// re-establishing it. SessionProviderWrapper.tsx's BackendTokenSync effect
// is what decides, on every session change, which of the two
// (NextAuth session.backendToken vs. this localStorage guest token) should
// currently populate `currentBackendToken` — see that file for the
// precedence rule (a real NextAuth session always wins once one exists).
export let currentBackendToken: string | null = null;

export function setBackendToken(token: string | null): void {
  currentBackendToken = token;
}

const GUEST_TOKEN_KEY = "guest_token";
const GUEST_NAME_KEY = "guest_name";
const HAS_SESSION_COOKIE = "has_session";

/** The guest-mode JWT previously stored by app/login/page.tsx's guest-login
 * button (see backend POST /api/auth/guest), or null if there isn't one /
 * we're not in a browser (SSR). */
export function getGuestToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(GUEST_TOKEN_KEY);
}

export function setGuestToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GUEST_TOKEN_KEY, token);
}

export function clearGuestToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(GUEST_TOKEN_KEY);
}

/** This guest's current display name, mirrored here in localStorage — the
 * actual source of truth is always the backend's users.name column (see
 * backend/app/routers/auth.py guest_login), this is just a client-side
 * cache seeded once at guest creation (app/join/[code]/page.tsx's guest
 * flow). Not shown anywhere in the UI anymore (this round's "訪客不該有任何
 * 帳號感" simplification removed components/UserMenu.tsx's guest name badge
 * and rename UI entirely — a guest is always just "訪客"), kept purely so
 * lib/useAuthIdentity.ts's `guest` identity still carries a real name value
 * rather than only ever falling back to the hardcoded default. */
export function getGuestName(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(GUEST_NAME_KEY);
}

export function setGuestName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GUEST_NAME_KEY, name);
}

export function clearGuestName(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(GUEST_NAME_KEY);
}

/** Sets a plain (non-httpOnly), no-actual-secret `has_session=1` cookie —
 * purely a signal middleware.ts's Edge-runtime `authorized()` callback can
 * read (Edge middleware can't reach into localStorage) to know "this browser
 * has *some* kind of session, guest or otherwise" without ever carrying the
 * real token itself. The real guest JWT only ever lives in localStorage (see
 * getGuestToken/setGuestToken above) — this cookie is deliberately
 * content-free. */
export function markHasSessionCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${HAS_SESSION_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function clearHasSessionCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${HAS_SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
