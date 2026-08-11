"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listTrips } from "@/lib/api";
import type { TripSummary } from "@/lib/types";
import TripCard from "@/components/TripCard";
import CreateTripDialog from "@/components/CreateTripDialog";
import BrandMark from "@/components/BrandMark";

export default function HomePage() {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const router = useRouter();

  const load = () => {
    listTrips()
      .then(setTrips)
      .catch((e) => setError(e instanceof Error ? e.message : "載入行程失敗"));
  };

  useEffect(load, []);

  return (
    <div className="flex-1 flex flex-col">
      <header className="flex items-center justify-between px-4 md:px-8 py-3.5 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <BrandMark />
          <div>
            <div className="font-bold text-slate-900 leading-tight">TravelSplit</div>
            <div className="hidden md:block text-xs text-slate-500 leading-tight">旅行分帳，回國一次結清</div>
          </div>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="hidden md:inline-flex bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm"
        >
          ＋ 建立新行程
        </button>
      </header>

      <main className="max-w-screen-xl mx-auto w-full px-4 md:px-8 py-6 md:py-7 flex-1">
        <p className="text-2xl md:text-3xl font-bold text-slate-900 mb-1">我的行程</p>
        <p className="text-sm text-slate-500 mb-5">
          {trips ? `共 ${trips.length} 趟行程・點擊卡片進入記帳列表` : "載入中…"}
        </p>

        <button
          onClick={() => setDialogOpen(true)}
          className="md:hidden w-full bg-teal-600 hover:bg-teal-700 text-white rounded-lg py-3.5 text-[15px] font-medium shadow-sm mb-5"
        >
          ＋ 建立新行程
        </button>

        {error && <p className="text-sm text-rose-600 mb-4">{error}</p>}

        {trips && trips.length === 0 && (
          <div className="border-2 border-dashed border-slate-300 rounded-xl py-16 flex flex-col items-center gap-3 text-center">
            <span className="w-12 h-12 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center text-2xl font-semibold">
              ＋
            </span>
            <p className="text-slate-700 font-semibold">建立你的第一趟旅行</p>
            <p className="text-sm text-slate-400 max-w-xs">
              新增成員、幣別匯率與分類，開始隨手記帳，回國後一次結清。
            </p>
            <button
              onClick={() => setDialogOpen(true)}
              className="mt-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm"
            >
              ＋ 建立新行程
            </button>
          </div>
        )}

        {trips && trips.length > 0 && (
          <>
            {/* Desktop grid */}
            <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-4">
              {trips.map((trip) => (
                <TripCard key={trip.id} trip={trip} onDeleted={load} />
              ))}
              <button
                onClick={() => setDialogOpen(true)}
                className="border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center gap-2 min-h-[196px] text-slate-500 hover:bg-slate-50"
              >
                <span className="w-10 h-10 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center text-xl font-semibold">
                  ＋
                </span>
                <span className="text-[13px] font-semibold">建立新行程</span>
              </button>
            </div>

            {/* Mobile list */}
            <div className="md:hidden flex flex-col gap-3">
              {trips.map((trip) => (
                <TripCard key={trip.id} trip={trip} onDeleted={load} />
              ))}
            </div>
            <p className="md:hidden text-center text-xs text-slate-400 mt-4">
              — 沒有更多行程了，點上方「＋」建立新的一趟 —
            </p>
          </>
        )}
      </main>

      <CreateTripDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          // The trip (and possibly some members/currencies) may already
          // exist even if the user closed the dialog after a partial-failure
          // toast instead of retrying — refresh so the home list (member
          // avatars, etc.) reflects whatever did get created.
          load();
        }}
        onTripCreated={load}
        onFinished={(trip) => {
          setDialogOpen(false);
          // Members/currencies are all set up in this single submit, so go
          // straight to the expense list instead of detouring through Settings.
          router.push(`/trips/${trip.id}`);
        }}
      />
    </div>
  );
}
