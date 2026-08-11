"use client";

import { useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { deleteTrip, ApiError } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";

/**
 * Deleting a trip is irreversible (cascades to all its members, currencies,
 * categories, expenses, etc.) — this is intentionally a dedicated dialog
 * with explicit warning copy instead of a bare window.confirm().
 */
export default function DeleteTripDialog({
  open,
  onClose,
  tripId,
  tripName,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  tripId: number;
  tripName: string;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteTrip(tripId);
      showToast(`已刪除行程「${tripName}」`);
      onDeleted();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "刪除行程失敗", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} title="刪除行程">
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          確定要刪除「<span className="font-semibold">{tripName}</span>」嗎？
        </p>
        <p className="text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5 leading-relaxed">
          此操作無法復原，將刪除此行程所有記帳資料，包含成員、幣別匯率、分類、付款方式與全部支出紀錄。
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button" disabled={busy}>
            取消
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={busy} type="button">
            {busy ? "刪除中…" : "確定刪除"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
