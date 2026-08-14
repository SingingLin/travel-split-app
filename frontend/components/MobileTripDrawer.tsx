"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, Trash2, X } from "lucide-react";
import BrandMark from "./BrandMark";
import UserMenu from "./UserMenu";
import CreateTripDialog from "./CreateTripDialog";
import DeleteTripDialog from "./DeleteTripDialog";
import { listTrips } from "@/lib/api";
import type { TripSummary } from "@/lib/types";
import { getTripBandColor } from "@/lib/tripColors";
import { useAuthIdentity } from "@/lib/useAuthIdentity";

/**
 * Mobile (`lg:`-below) equivalent of components/TripSidebar.tsx's desktop
 * persistent sidebar — a hamburger icon button that opens a left-sliding
 * drawer with the same content (brand, trip list, "＋ 建立新行程", UserMenu)
 * so switching trips on a phone never requires detouring back to "/" first,
 * matching the desktop sidebar's round of work. Renders ONLY the hamburger
 * button + drawer (both `lg:hidden`) — the caller (components/TripNav.tsx's
 * mobile header, app/page.tsx's mobile header) places this button wherever
 * it belongs in that specific header's layout; it does not render a header
 * of its own, to avoid ever duplicating the desktop sidebar which each of
 * those pages already mounts separately (see TripSidebar.tsx, `hidden
 * lg:flex` — the two never show at the same time by construction, since
 * this component's own trigger button is `lg:hidden`).
 *
 * Fetches its own trip list on open (not on mount) — this is a rarely-opened
 * overlay, no need to keep a background fetch running on every trip-page
 * render just in case the user opens it.
 */
export default function MobileTripDrawer({ activeTripId }: { activeTripId?: number }) {
  const [open, setOpen] = useState(false);
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Same "刪除行程" affordance as TripSidebar.tsx's desktop rows — see that
  // file's deleteTarget comment for the full rationale (this replaces
  // TripCard.tsx's old delete icon now that app/page.tsx no longer renders
  // a card grid).
  const [deleteTarget, setDeleteTarget] = useState<TripSummary | null>(null);
  const router = useRouter();
  // Same "guest can never create a trip" gate as components/TripSidebar.tsx
  // — see that file's `canCreateTrip` comment for the full rationale.
  const identity = useAuthIdentity();
  const canCreateTrip = identity.kind !== "guest";

  const loadTrips = () => {
    listTrips()
      .then(setTrips)
      .catch(() => {
        // Same "secondary nav aid, fail silently" rationale as
        // TripSidebar.tsx's own load() — the page underneath already shows
        // its own error state for the same failed request if relevant.
      });
  };

  useEffect(() => {
    if (!open) return;
    loadTrips();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="開啟行程選單"
        title="行程選單"
        className="lg:hidden w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"
      >
        <Menu size={16} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-900/40"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="行程選單"
        >
          <aside
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white flex flex-col shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100 shrink-0">
              <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
                <BrandMark />
                <span className="font-bold text-slate-900">TravelSplit</span>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="關閉選單"
                className="text-slate-400 hover:text-slate-600 w-7 h-7 flex items-center justify-center shrink-0"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

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
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-[14px] min-w-0 ${
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
                        className="shrink-0 w-7 h-7 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                      >
                        <Trash2 size={14} aria-hidden="true" />
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
                className="mx-2 mb-2 shrink-0 flex items-center gap-1.5 px-2.5 py-2.5 rounded-lg text-[13.5px] font-semibold text-teal-700 hover:bg-teal-50"
              >
                ＋ 建立新行程
              </button>
            )}

            <div className="border-t border-slate-100 px-3 py-3 shrink-0">
              <UserMenu />
            </div>
          </aside>
        </div>
      )}

      <CreateTripDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onFinished={(trip) => {
          setDialogOpen(false);
          setOpen(false);
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
            loadTrips();
            // Same "nothing left to show, go home and let it redirect" logic
            // as TripSidebar.tsx's own onDeleted handler.
            if (deletedActiveTrip) {
              setOpen(false);
              router.push("/");
            }
          }}
        />
      )}
    </>
  );
}
