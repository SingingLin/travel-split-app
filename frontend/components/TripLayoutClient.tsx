"use client";

import { ReactNode } from "react";
import { TripProvider, useTrip } from "@/lib/TripContext";
import TripNav, { BottomTabBar } from "@/components/TripNav";
import TripSidebar from "@/components/TripSidebar";

function Inner({ tripId, children }: { tripId: number; children: ReactNode }) {
  const { trip, loading, error } = useTrip();

  // TripSidebar is mounted for every state below (loading/error/loaded) —
  // even if THIS trip fails to load, the sidebar still lets the user switch
  // straight to a different one instead of being stuck on a dead-end error
  // screen with only "back to home" as an escape hatch.
  if (loading && !trip) {
    return (
      <div className="flex-1 flex min-h-screen">
        <TripSidebar activeTripId={tripId} />
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">載入行程中…</div>
      </div>
    );
  }
  if (error || !trip) {
    return (
      <div className="flex-1 flex min-h-screen">
        <TripSidebar activeTripId={tripId} />
        <div className="flex-1 flex items-center justify-center text-rose-600 text-sm">
          {error ?? "找不到這趟行程"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-screen">
      <TripSidebar activeTripId={tripId} />
      <div className="flex-1 flex flex-col min-w-0">
        <TripNav trip={trip} />
        <main className="flex-1 pb-20 lg:pb-0">{children}</main>
        <BottomTabBar tripId={tripId} myRole={trip.my_role} />
      </div>
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
