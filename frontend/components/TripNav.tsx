"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { Receipt, Scale, Settings, type LucideIcon } from "lucide-react";
import { AvatarStack } from "./Avatar";
import UserMenu from "./UserMenu";
import GuestBanner from "./GuestBanner";
import MobileTripDrawer from "./MobileTripDrawer";
import type { TripDetail } from "@/lib/types";

// Emoji (📒/⚖️/⚙️) replaced with lucide-react icons — emoji render with
// different colors/weights across OS/browser (macOS vs Windows vs Android),
// which reads as inconsistent next to the rest of the site's icon-like
// symbols (see uiux-audit-2026-08-12.md §1.2). `icon` is now a component
// reference, not a string, rendered directly in BottomTabBar below.
const TABS: { key: string; label: string; mobileLabel?: string; icon: LucideIcon; href: (id: number) => string }[] = [
  { key: "expenses", label: "記帳", icon: Receipt, href: (id: number) => `/trips/${id}` },
  { key: "settlement", label: "結算總覽", mobileLabel: "結算", icon: Scale, href: (id: number) => `/trips/${id}/settlement` },
  { key: "settings", label: "設定", icon: Settings, href: (id: number) => `/trips/${id}/settings` },
];

function activeKey(pathname: string, tripId: number): string {
  if (pathname === `/trips/${tripId}` || pathname.startsWith(`/trips/${tripId}/expenses`)) return "expenses";
  if (pathname.startsWith(`/trips/${tripId}/settlement`)) return "settlement";
  if (pathname.startsWith(`/trips/${tripId}/settings`)) return "settings";
  return "expenses";
}

/** A "contributor" (guest — see backend models.TripAccess's docstring) may
 * only record new expenses and view the settlement overview (this round's
 * "訪客也能是完整成員" simplification) — the entire "設定" tab is off-limits,
 * so its nav entry is hidden outright rather than just left to 403 after a
 * click. See components/SettingsPageClient.tsx for the matching
 * direct-URL guard. */
function tabsForRole(role: string) {
  return role === "contributor" ? TABS.filter((t) => t.key !== "settings") : TABS;
}

export default function TripNav({
  trip,
  mobileTitle,
  mobileRight,
}: {
  trip: TripDetail;
  mobileTitle?: string;
  mobileRight?: ReactNode;
}) {
  const pathname = usePathname();
  const active = activeKey(pathname, trip.id);
  const tabs = tabsForRole(trip.my_role);
  const defaultMobileTitle =
    active === "settings" ? "行程設定" : active === "settlement" ? "結算總覽" : trip.name;

  return (
    <>
      {/* Desktop top nav — no brand mark/wordmark here: the persistent left
          sidebar (components/TripSidebar.tsx, always mounted alongside this
          nav on desktop) already shows "TravelSplit" once at the very top;
          repeating it here just duplicated it right next to the trip name
          (real-user feedback via screenshot). */}
      <header className="hidden lg:flex items-center justify-between px-8 py-3 border-b border-slate-200 bg-white sticky top-0 z-30">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-slate-800">{trip.name}</span>
          <nav className="flex items-center gap-1 bg-slate-100 rounded-full p-1 ml-2">
            {tabs.map((tab) => (
              <Link
                key={tab.key}
                href={tab.href(trip.id)}
                className={`text-sm font-semibold px-3.5 py-1.5 rounded-full transition-colors ${
                  active === tab.key ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <UserMenu />
          <AvatarStack members={trip.members} size="sm" max={6} />
        </div>
      </header>
      <div className="hidden lg:block sticky top-[49px] z-20">
        <GuestBanner />
      </div>

      {/* Mobile sticky header */}
      <header className="lg:hidden flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-white sticky top-0 z-30">
        <div className="flex items-center gap-2 min-w-0">
          <MobileTripDrawer activeTripId={trip.id} />
          <span className="font-bold text-slate-900 text-[15px] truncate">{mobileTitle ?? defaultMobileTitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <UserMenu />
          {mobileRight}
        </div>
      </header>
      <div className="lg:hidden sticky top-[53px] z-20">
        <GuestBanner />
      </div>
    </>
  );
}

export function BottomTabBar({ tripId, myRole }: { tripId: number; myRole?: string }) {
  const pathname = usePathname();
  const active = activeKey(pathname, tripId);
  const tabs = tabsForRole(myRole ?? "");
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex border-t border-slate-200 bg-white">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={tab.href(tripId)}
            className={`flex-1 flex flex-col items-center pt-2 pb-3 text-[10.5px] ${
              active === tab.key ? "text-teal-600 font-semibold" : "text-slate-400"
            }`}
          >
            <Icon size={18} className="mb-0.5" aria-hidden="true" />
            {tab.mobileLabel ?? tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
