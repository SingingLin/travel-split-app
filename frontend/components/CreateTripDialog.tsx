"use client";

import { useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import Select from "./Select";
import { createTrip, ApiError } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import { CURATED_CURRENCIES, formatCurrencyOption } from "@/lib/currencies";
import type { TripDetail } from "@/lib/types";

/**
 * "建立新行程" dialog — deliberately minimal: just 行程名稱 + 幣別.
 *
 * Used to also collect members and a base-currency-plus-extra-currencies
 * block in this same dialog, but backend/app/routers/trips.py's create_trip
 * now auto-adds the creator as this trip's first Member (see that
 * function — TripAccess for permissions is separate from Member for split-
 * accounting, but the creator gets both automatically), so there's no
 * longer anything for this form to collect there; members beyond the
 * creator are added later from the trip's settings page. Likewise, only a
 * single currency (the trip's base currency) is collected here — additional
 * currencies/exchange rates are set up afterward in the trip's existing
 * 設定 → 幣別匯率 section, which already supports adding as many as needed.
 * Splitting "create" from "configure more currencies" this way means this
 * dialog never needs its own rate-lookup/partial-retry machinery — it's a
 * single POST /api/trips call.
 */
export default function CreateTripDialog({
  open,
  onClose,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired once the trip has been created. */
  onFinished: (trip: TripDetail) => void;
}) {
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [errors, setErrors] = useState<{ name?: string; currency?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const resetAll = () => {
    setName("");
    setCurrencyCode("");
    setErrors({});
  };

  const handleClose = () => {
    if (submitting) return;
    resetAll();
    onClose();
  };

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    const trimmedName = name.trim();
    if (!trimmedName) newErrors.name = "請輸入行程名稱";
    if (!currencyCode) newErrors.currency = "請選擇幣別";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const option = CURATED_CURRENCIES.find((c) => c.code === currencyCode);

    setSubmitting(true);
    try {
      const trip = await createTrip({
        name: trimmedName,
        base_currency_code: currencyCode,
        base_currency_name: option?.name ?? currencyCode,
      });
      resetAll();
      onFinished(trip);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "建立行程失敗";
      showToast(message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";
  const labelCls = "block text-[11.5px] font-medium text-slate-500 mb-1";

  return (
    <Dialog open={open} onClose={handleClose} title="建立新行程">
      <div className="space-y-4">
        <div>
          <label className={labelCls}>行程名稱</label>
          <input
            className={inputCls}
            placeholder="例如：峇里島 5 日遊"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            autoFocus
          />
          {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name}</p>}
        </div>

        <div>
          <label className={labelCls}>幣別</label>
          <Select
            value={currencyCode}
            onChange={(v) => {
              setCurrencyCode(v);
              if (errors.currency) setErrors((prev) => ({ ...prev, currency: undefined }));
            }}
            placeholder="選擇幣別…"
            options={CURATED_CURRENCIES.map((c) => ({ value: c.code, label: formatCurrencyOption(c) }))}
          />
          {errors.currency && <p className="text-xs text-rose-600 mt-1">{errors.currency}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} type="button" disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} type="button">
            {submitting ? "建立中…" : "建立行程"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
