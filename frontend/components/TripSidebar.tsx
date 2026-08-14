"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import BrandMark from "./BrandMark";
import UserMenu from "./UserMenu";
import CreateTripDialog from "./CreateTripDialog";
import DeleteTripDialog from "./DeleteTripDialog";
import { listTrips } from "@/lib/api";
import type { TripSummary } from "@/lib/types";
import { getTripBandColor } from "@/lib/tripColors";
import { useAuthIdentity } from "@/lib/useAuthIdentity";

/**
 * Desktop-only (`lg:`+) persistent left sidebar, mounted alongside both the
 * home page (app/page.tsx) and every trip subpage (components/
 * TripLayoutClient.tsx) so switching trips never requires detouring back to
 * "/" first — real-user feedback after trying the app was that always
 * having to go home first to switch trips was annoying. Renders nothing
 * below `lg:` on purpose: this round only covers desktop, mobile keeps its
 * existing navigation (the back-arrow + bottom tab bar in TripNav.tsx).
 *
 * Fetches its own trip list independently of whatever page it's mounted in
 * (home's own `trips` state, TripContext's single `trip`, etc.) since it
 * always needs to show EVERY trip the user can access regardless of which
 * one (if any) the current page happens to be about.
 */
export default function TripSidebar({ activeTripId }: { activeTripId?: number }) {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Trip currently targeted by the "刪除行程" confirm dialog — see
  // TripCard.tsx's original delete affordance, which this row-level one
  // replaces now that the home page no longer renders a card grid (see
  // app/page.tsx). Only ever offered on rows the viewer owns (my_role ===
  // "owner" — see backend schemas.TripSummaryOut.my_role), same as the old
  // card's implicit assumption (delete_trip is owner-only server-side too).
  const [deleteTarget, setDeleteTarget] = useState<TripSummary | null>(null);
  const router = useRouter();
  // A guest (this round's "訪客也能是完整成員" simplification) can only ever
  // gain access to a trip by redeeming an invite link — there is no path
  // that lets a guest create a brand-new one (backend create_trip 403s a
  // guest outright, see app/routers/trips.py) — so this entry point hides
  // for a guest rather than opening a dialog whose submit was always going
  // to fail.
  const identity = useAuthIdentity();
  const canCreateTrip = identity.kind !== "guest";

  const load = () => {
    listTrips()
      .then(setTrips)
      .catch(() => {
        // The sidebar is a secondary navigation aid, not the page's primary
        // data — silently leave the list empty rather than surface a second,
        // duplicate error toast/banner on top of whatever the page itself is
        // already showing for this same failed request (e.g. TripContext's
        // own error state, or HomePage's own `error`).
      });
  };

  useEffect(load, []);

  return (
    <>
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-slate-200 bg-white h-screen sticky top-0">
        <Link href="/" className="flex items-center gap-2 px-4 py-4 border-b border-slate-100 shrink-0">
          <BrandMark />
          <span className="font-bold text-slate-900">TravelSplit</span>
        </Link>

        <nav className="flex-1 overflow-y-auto py-2 px-2 flex flex-col gap-0.5">
          {trips === null && <p className="px-2.5 py-2 text-xs text-slate-400">載入中…</p>}
          {trips?.length === 0 && <p className="px-2.5 py-2 text-xs text-slate-400">尚無行程</p>}
          {trips?.map((trip, i) => {
            const active = trip.id === activeTripId;
            const openDeleteConfirm = (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setDeleteTarget(trip);
            };
            return (
              <Link
                key={trip.id}
                href={`/trips/${trip.id}`}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13.5px] min-w-0 ${
                  active ? "bg-teal-50 text-teal-700 font-semibold" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: getTripBandColor(i) }}
                  aria-hidden="true"
                />
                <span className="truncate flex-1">{trip.name}</span>
                {trip.my_role === "owner" && (
                  <button
                    type="button"
                    aria-label="刪除行程"
                    title="刪除行程"
                    onClick={openDeleteConfirm}
                    className="shrink-0 w-6 h-6 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 items-center justify-center hidden group-hover:flex"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </Link>
            );
          })}
        </nav>

        {canCreateTrip && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="mx-2 mb-2 shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[13px] font-semibold text-teal-700 hover:bg-teal-50"
          >
            ＋ 建立新行程
          </button>
        )}

        <div className="border-t border-slate-100 px-3 py-3 shrink-0">
          <UserMenu />
        </div>
      </aside>

      <CreateTripDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onFinished={(trip) => {
          setDialogOpen(false);
          load();
          router.push(`/trips/${trip.id}`);
        }}
      />

      {deleteTarget && (
        <DeleteTripDialog
          open={deleteTarget != null}
          onClose={() => setDeleteTarget(null)}
          tripId={deleteTarget.id}
          tripName={deleteTarget.name}
          onDeleted={() => {
            const deletedActiveTrip = deleteTarget.id === activeTripId;
            setDeleteTarget(null);
            load();
            // If we just deleted the trip the user was currently looking at,
            // that page has nothing left to show — send them home, where
            // app/page.tsx redirects into whatever trip is left (or shows
            // the empty state if that was the last one).
            if (deletedActiveTrip) router.push("/");
          }}
        />
      )}
    </>
  );
}
