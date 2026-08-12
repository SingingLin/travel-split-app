"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/Card";
import Button from "@/components/Button";
import DeleteTripDialog from "@/components/DeleteTripDialog";
import type { TripDetail } from "@/lib/types";

/**
 * Standalone "危險區塊" card — deliberately its own Card at the very bottom
 * of the settings page, separated from TripInfoSection (trip name / initial
 * exchange record). Previously this shared a single card with the trip-name
 * editor, only divided by a border line; per uiux-audit-2026-08-12.md §1.7
 * an irreversible, high-impact action (delete the whole trip) needs stronger
 * visual isolation from routine edits, especially on mobile where §1.5's
 * default-expanded accordion used to put this red button right in front of
 * the user the moment they opened 行程設定. Confirmation flow (DeleteTripDialog)
 * is unchanged.
 */
export default function DangerZoneSection({ trip }: { trip: TripDetail }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter();

  return (
    <Card>
      <p className="text-xs font-semibold text-rose-600 mb-1">危險區塊</p>
      <p className="text-[11.5px] text-slate-400 mb-2.5">
        刪除此行程將一併移除所有成員、幣別匯率、分類與支出紀錄，且無法復原。
      </p>
      <Button variant="danger" type="button" onClick={() => setDeleteOpen(true)}>
        刪除此行程
      </Button>

      <DeleteTripDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        tripId={trip.id}
        tripName={trip.name}
        onDeleted={() => {
          setDeleteOpen(false);
          router.push("/");
        }}
      />
    </Card>
  );
}
