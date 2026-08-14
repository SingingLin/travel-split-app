"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import BrandMark from "@/components/BrandMark";

/** Reads `callbackUrl` (set by middleware.ts when it redirects an
 * unauthenticated visit here, or by a page like app/join/[code]/page.tsx
 * that itself requires login first) and passes it straight through to
 * signIn() so Google login lands the user back where they were headed
 * instead of always dropping them on the home page. Wrapped in <Suspense>
 * per Next.js's requirement for useSearchParams() in a page component.
 *
 * NOTE: this card used to also offer "略過登入，先用訪客身分開始" — a
 * standalone entry point that created a brand-new guest identity with no
 * trip to interact with. This round's "訪客也能是完整成員" simplification
 * removed that entirely: a guest identity is now ONLY ever created by
 * redeeming an invite link (see app/join/[code]/page.tsx's guest flow,
 * which still calls POST /api/auth/guest itself) — a guest created here,
 * with no invite code in hand, would have had no trip to see or do
 * anything with.
 *
 * A later round's "訪客不該有任何帳號感" simplification also removed the
 * "用找回代碼登入" recovery entry that used to sit below the Google button
 * — guest mode no longer has a recovery/"log back in" mechanism at all (see
 * backend/app/routers/auth.py guest_login's docstring and models.User.
 * recovery_code's docstring for what got retired). This page is now just
 * the plain Google sign-in card. */
function LoginCard() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex flex-col items-center text-center">
        <BrandMark className="w-14 h-14" rounded="rounded-2xl" />
        <p className="mt-4 text-xl font-bold text-slate-900">TravelSplit</p>
        <p className="mt-1 text-sm text-slate-500">旅行分帳，回國一次結清</p>

        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="mt-8 w-full inline-flex items-center justify-center gap-2.5 border border-slate-300 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm"
        >
          <svg viewBox="0 0 24 24" className="w-4.5 h-4.5" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.57-5.17 3.57-8.83z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11A11.99 11.99 0 0 0 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.6H1.26A11.99 11.99 0 0 0 0 12c0 1.94.46 3.77 1.26 5.4l4.01-3.11z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.6l4.01 3.11C6.22 6.86 8.87 4.75 12 4.75z"
            />
          </svg>
          使用 Google 帳號登入
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginCard />
    </Suspense>
  );
}
