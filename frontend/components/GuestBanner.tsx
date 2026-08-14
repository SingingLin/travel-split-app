"use client";

import { signIn } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useAuthIdentity } from "@/lib/useAuthIdentity";

/**
 * Persistent "訪客模式" upgrade prompt — only renders while
 * lib/useAuthIdentity.ts reports "guest" (renders nothing for every other
 * identity state, including the brief "loading" tick, so it never flashes
 * for a Google-logged-in user). Clicking "登入 Google 帳號" starts a normal
 * NextAuth Google sign-in with `callbackUrl` set to wherever the guest
 * currently is, so they land back on the same page once done; the actual
 * guest-data merge (POST /api/auth/link-guest) happens automatically right
 * after that sign-in completes — see components/GuestLinkHandler.tsx, which
 * is what notices the guest token still in localStorage and folds it into
 * the new Google account.
 */
export default function GuestBanner() {
  const identity = useAuthIdentity();
  const pathname = usePathname();

  if (identity.kind !== "guest") return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 md:px-8 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800">
      <p className="text-xs leading-snug">
        訪客模式：資料只存在這個瀏覽器，登入 Google 帳號可以永久保存、換裝置也看得到。
      </p>
      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl: pathname || "/" })}
        className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm"
      >
        登入 Google 帳號
      </button>
    </div>
  );
}
