import Link from "next/link";
import { AvatarStack } from "./Avatar";
import { TripStatusBadge } from "./Chip";
import { formatDateFull, formatMoney } from "@/lib/format";
import type { TripSummary } from "@/lib/types";

export default function TripCard({ trip }: { trip: TripSummary }) {
  const dateRange =
    trip.start_date && trip.end_date
      ? `${formatDateFull(trip.start_date)} – ${formatDateFull(trip.end_date)}`
      : "尚未設定日期";

  return (
    <Link
      href={`/trips/${trip.id}`}
      className="block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      {/* Desktop layout */}
      <div className="hidden md:block">
        <div className="h-1.5" style={{ backgroundColor: trip.band_color }} />
        <div className="px-[18px] pt-4">
          <p className="text-base font-semibold text-slate-900 mb-0.5">{trip.name}</p>
          <p className="text-xs text-slate-500 mb-3.5">{dateRange}</p>
          <div className="flex items-end justify-between mt-3.5">
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
          <p className="font-semibold text-slate-900 text-[15px] flex-1 truncate">{trip.name}</p>
          <TripStatusBadge status={trip.status} />
        </div>
        <p className="text-[11.5px] text-slate-500 ml-4">{dateRange}</p>
        <div className="flex items-center justify-between">
          <AvatarStack members={trip.members} size="sm" />
          <span className="text-base font-bold tabular-nums text-slate-900">
            {formatMoney(trip.total_base_amount, trip.base_currency_code)}
          </span>
        </div>
      </div>
    </Link>
  );
}
