"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listTrips } from "@/lib/api";
import type { TripSummary } from "@/lib/types";
import CreateTripDialog from "@/components/CreateTripDialog";
import UserMenu from "@/components/UserMenu";
import GuestBanner from "@/components/GuestBanner";
import TripSidebar from "@/components/TripSidebar";
import MobileTripDrawer from "@/components/MobileTripDrawer";

/**
 * Home page. Real-user feedback was that the old "我的行程" grid of
 * TripCard's here was pure duplication of the persistent trip navigation
 * (TripSidebar.tsx desktop / MobileTripDrawer.tsx mobile) added alongside
 * every page — same list, same content, twice on screen. So this page no
 * longer renders a trip list of its own at all:
 *   - Has >=1 trip: silently redirect straight into the first one GET
 *     /api/trips returns (backend orders by Trip.created_at desc — see
 *     routers/trips.py trip_summaries_for_user — so "most recently created"
 *     doubles as "most likely the one you want" without needing a dedicated
 *     "last visited" concept this round).
 *   - Zero trips: show a plain welcome/empty state with a single "建立新
 *     行程" entry point instead of a list that would just be empty anyway.
 * The sidebar/drawer stay mounted the whole time (including mid-redirect)
 * so navigation never flashes away.
 */
export default function HomePage() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    listTrips()
      .then(setTrips)
      .catch((e) => setError(e instanceof Error ? e.message : "載入行程失敗"));
  }, []);

  useEffect(() => {
    if (trips && trips.length > 0) {
      router.replace(`/trips/${trips[0].id}`);
    }
  }, [trips, router]);

  // While trips are loading, or once we know there's at least one and a
  // redirect is already in flight, there's nothing meaningful to paint in
  // <main> — avoid flashing an empty state right before the redirect fires.
  const showEmptyState = trips !== null && trips.length === 0;
  const showLoading = trips === null && !error;

  return (
    <div className="flex-1 flex">
      {/* Desktop persistent sidebar — see components/TripSidebar.tsx. Home
          page has no single "active" trip, so activeTripId is left unset
          (every row renders in its normal, non-active style). */}
      <TripSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* No brand mark/wordmark here on purpose: on desktop the persistent
            left sidebar (components/TripSidebar.tsx) already shows
            "TravelSplit" once at the top, and on mobile MobileTripDrawer's
            own drawer shows it again the moment it's opened — repeating it a
            third time in this header was pure duplication (real-user
            feedback via screenshot). The hamburger button below is what
            actually opens that mobile drawer. */}
        <header className="flex items-center justify-between px-4 md:px-8 py-3.5 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2">
            <MobileTripDrawer />
            <p className="hidden md:block text-xs text-slate-500 leading-tight">旅行分帳，回國一次結清</p>
          </div>
          <div className="flex items-center gap-3">
            <UserMenu />
            <button
              onClick={() => setDialogOpen(true)}
              className="hidden md:inline-flex bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm"
            >
              ＋ 建立新行程
            </button>
          </div>
        </header>
        <GuestBanner />

        <main className="max-w-screen-xl mx-auto w-full px-4 md:px-8 py-6 md:py-7 flex-1 flex flex-col">
          {error && <p className="text-sm text-rose-600 mb-4">{error}</p>}

          {showLoading && <p className="text-sm text-slate-400">載入中…</p>}

          {showEmptyState && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-16">
              <span className="w-14 h-14 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center text-2xl font-semibold">
                ＋
              </span>
              <p className="text-2xl font-bold text-slate-900">歡迎使用 TravelSplit</p>
              <p className="text-sm text-slate-500 max-w-xs">
                新增成員、幣別匯率與分類，開始隨手記帳，回國後一次結清。
              </p>
              <button
                onClick={() => setDialogOpen(true)}
                className="mt-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-5 py-2.5 text-sm font-medium shadow-sm"
              >
                ＋ 建立新行程
              </button>
            </div>
          )}
        </main>

        <CreateTripDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onFinished={(trip) => {
            setDialogOpen(false);
            // Creator is auto-added as this trip's first member server-side
            // (see backend/app/routers/trips.py create_trip), so go straight
            // to the expense list instead of detouring through Settings.
            router.push(`/trips/${trip.id}`);
          }}
        />
      </div>
    </div>
  );
}
