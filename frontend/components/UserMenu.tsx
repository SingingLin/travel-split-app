"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import Avatar from "./Avatar";
import Dialog from "./Dialog";
import Button from "./Button";
import { useAuthIdentity } from "@/lib/useAuthIdentity";

/**
 * "Who am I / logout" control for a real (Google) login — mounted in both
 * TripNav.tsx (trip pages), components/TripSidebar.tsx (desktop persistent
 * sidebar) and app/page.tsx (home) headers, see those files.
 *
 * Renders NOTHING for a guest (see the early return below) — this round's
 * "訪客不該有任何帳號感" simplification: a guest has no name worth
 * managing (always "訪客"), no rename affordance (removed along with the
 * name-at-join-time input, see app/join/[code]/page.tsx), and no "logout"
 * concept at all (a guest's browser-local token just stops mattering once
 * they close the tab/leave the trip — nothing to explicitly sign out of).
 * The guest's token itself is untouched by this — it keeps working under
 * the hood (see lib/authToken.ts) so the guest can keep recording expenses;
 * this component just never surfaces any "you're logged in as a guest
 * account" UI for it. See components/GuestBanner.tsx for the (unrelated)
 * "登入 Google 帳號" upgrade prompt still shown for a guest.
 *
 * Logging out (Google identity only, now) goes through a confirmation
 * Dialog (same pattern as DeleteTripDialog.tsx) instead of firing
 * immediately on click — real-user feedback was that an instant logout was
 * too easy to hit by accident.
 */
export default function UserMenu() {
  const identity = useAuthIdentity();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (identity.kind !== "google") return null;

  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-600">
          {/* Avatar itself now handles the "show the real Google photo,
              fall back to the initials/color chip (incl. on a load error
              via onError)" logic — see components/Avatar.tsx. */}
          <Avatar name={identity.name} color="#0d9488" avatarUrl={identity.image} size="xs" />
          {identity.name}
        </span>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          aria-label="登出"
          title="登出"
          className="text-slate-400 hover:text-rose-600 inline-flex items-center gap-1 text-xs font-medium"
        >
          <LogOut size={14} aria-hidden="true" />
          <span className="hidden sm:inline">登出</span>
        </button>
      </div>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} title="登出">
        <div className="space-y-4">
          <p className="text-sm text-slate-700">確定要登出嗎？登出後仍可以隨時用同一個 Google 帳號再次登入，資料都還在。</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} type="button">
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmOpen(false);
                signOut({ callbackUrl: "/login" });
              }}
              type="button"
            >
              確定登出
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
