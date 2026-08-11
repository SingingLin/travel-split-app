"use client";

import { ReactNode } from "react";
import { TripProvider, useTrip } from "@/lib/TripContext";
import TripNav, { BottomTabBar } from "@/components/TripNav";

function Inner({ tripId, children }: { tripId: number; children: ReactNode }) {
  const { trip, loading, error } = useTrip();

  if (loading && !trip) {
    return <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">載入行程中…</div>;
  }
  if (error || !trip) {
    return (
      <div className="flex-1 flex items-center justify-center text-rose-600 text-sm">
        {error ?? "找不到這趟行程"}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <TripNav trip={trip} />
      <main className="flex-1 pb-20 lg:pb-0">{children}</main>
      <BottomTabBar tripId={tripId} />
    </div>
  );
}

export default function TripLayoutClient({ tripId, children }: { tripId: number; children: ReactNode }) {
  return (
    <TripProvider tripId={tripId}>
      <Inner tripId={tripId}>{children}</Inner>
    </TripProvider>
  );
}
