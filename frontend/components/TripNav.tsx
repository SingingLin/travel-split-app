"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode } from "react";
import { AvatarStack } from "./Avatar";
import BrandMark from "./BrandMark";
import type { TripDetail } from "@/lib/types";

const TABS = [
  { key: "expenses", label: "記帳", icon: "📒", href: (id: number) => `/trips/${id}` },
  { key: "settlement", label: "結算總覽", mobileLabel: "結算", icon: "⚖️", href: (id: number) => `/trips/${id}/settlement` },
  { key: "settings", label: "設定", icon: "⚙️", href: (id: number) => `/trips/${id}/settings` },
];

function activeKey(pathname: string, tripId: number): string {
  if (pathname === `/trips/${tripId}` || pathname.startsWith(`/trips/${tripId}/expenses`)) return "expenses";
  if (pathname.startsWith(`/trips/${tripId}/settlement`)) return "settlement";
  if (pathname.startsWith(`/trips/${tripId}/settings`)) return "settings";
  return "expenses";
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
  const router = useRouter();
  const active = activeKey(pathname, trip.id);
  const defaultMobileTitle =
    active === "settings" ? "行程設定" : active === "settlement" ? "結算總覽" : trip.name;

  return (
    <>
      {/* Desktop top nav */}
      <header className="hidden lg:flex items-center justify-between px-8 py-3 border-b border-slate-200 bg-white sticky top-0 z-30">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark />
            <span className="font-bold text-slate-900">TravelSplit</span>
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-semibold text-slate-800">{trip.name}</span>
          <nav className="flex items-center gap-1 bg-slate-100 rounded-full p-1 ml-2">
            {TABS.map((tab) => (
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
        <AvatarStack members={trip.members} size="sm" max={6} />
      </header>

      {/* Mobile sticky header */}
      <header className="lg:hidden flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-white sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push("/")}
            aria-label="返回首頁"
            className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-sm shrink-0"
          >
            ←
          </button>
          <span className="font-bold text-slate-900 text-[15px] truncate">{mobileTitle ?? defaultMobileTitle}</span>
        </div>
        {mobileRight}
      </header>
    </>
  );
}

export function BottomTabBar({ tripId }: { tripId: number }) {
  const pathname = usePathname();
  const active = activeKey(pathname, tripId);
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex border-t border-slate-200 bg-white">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href(tripId)}
          className={`flex-1 text-center pt-2 pb-3 text-[10.5px] ${
            active === tab.key ? "text-teal-600 font-semibold" : "text-slate-400"
          }`}
        >
          <span className="block text-base mb-0.5">{tab.icon}</span>
          {tab.mobileLabel ?? tab.label}
        </Link>
      ))}
    </nav>
  );
}
