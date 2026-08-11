"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { AvatarStack } from "./Avatar";
import { TripStatusBadge } from "./Chip";
import DeleteTripDialog from "./DeleteTripDialog";
import { formatMoney } from "@/lib/format";
import type { TripSummary } from "@/lib/types";

export default function TripCard({ trip, onDeleted }: { trip: TripSummary; onDeleted?: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const openConfirm = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmOpen(true);
  };

  return (
    <div className="relative bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      <button
        type="button"
        aria-label="刪除行程"
        title="刪除行程"
        onClick={openConfirm}
        className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-white/95 border border-slate-200 shadow-sm text-slate-400 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center text-sm"
      >
        🗑
      </button>

      <Link href={`/trips/${trip.id}`} className="block">
        {/* Desktop layout */}
        <div className="hidden md:block">
          <div className="h-1.5" style={{ backgroundColor: trip.band_color }} />
          <div className="px-[18px] pt-4">
            <p className="text-base font-semibold text-slate-900 mb-3 pr-7">{trip.name}</p>
            <div className="flex items-end justify-between">
              <AvatarStack members={trip.members} size="sm" />
              <div className="text-right">
                <span className="block text-[11px] text-slate-400 mb-0.5">總花費</span>
                <span className="text-lg font-bold tabular-nums text-slate-900">
                  {formatMoney(trip.total_base_amount, trip.base_currency_code)}
                </span>
              </div>
            </div>
          </div>
          <div className="px-[18px] pt-3 pb-4">
            <TripStatusBadge status={trip.status} />
          </div>
        </div>

        {/* Mobile layout */}
        <div className="md:hidden p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trip.band_color }} />
            <p className="font-semibold text-slate-900 text-[15px] flex-1 truncate pr-7">{trip.name}</p>
            <TripStatusBadge status={trip.status} />
          </div>
          <div className="flex items-center justify-between">
            <AvatarStack members={trip.members} size="sm" />
            <span className="text-base font-bold tabular-nums text-slate-900">
              {formatMoney(trip.total_base_amount, trip.base_currency_code)}
            </span>
          </div>
        </div>
      </Link>

      <DeleteTripDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        tripId={trip.id}
        tripName={trip.name}
        onDeleted={() => {
          setConfirmOpen(false);
          onDeleted?.();
        }}
      />
    </div>
  );
}
