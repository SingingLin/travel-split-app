"use client";

import { useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { createTrip } from "@/lib/api";
import type { TripDetail } from "@/lib/types";

const BAND_COLORS = ["#0d9488", "#f59e0b", "#6366f1", "#ec4899", "#0ea5e9", "#84cc16"];

export default function CreateTripDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (trip: TripDetail) => void;
}) {
  const [name, setName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("TWD");
  const [currencyName, setCurrencyName] = useState("新台幣");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [bandColor, setBandColor] = useState(BAND_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setCurrencyCode("TWD");
    setCurrencyName("新台幣");
    setStartDate("");
    setEndDate("");
    setBandColor(BAND_COLORS[0]);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("請輸入行程名稱");
      return;
    }
    if (!currencyCode.trim()) {
      setError("請輸入基準幣別代碼");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const trip = await createTrip({
        name: name.trim(),
        base_currency_code: currencyCode.trim().toUpperCase(),
        base_currency_name: currencyName.trim(),
        start_date: startDate || null,
        end_date: endDate || null,
        band_color: bandColor,
      });
      reset();
      onCreated(trip);
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立行程失敗");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="建立新行程">
      <div className="space-y-4">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">行程名稱</label>
          <input
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
            placeholder="例如：峇里島 5 日遊"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">基準幣別代碼</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
              placeholder="TWD"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">幣別名稱</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
              placeholder="新台幣"
              value={currencyName}
              onChange={(e) => setCurrencyName(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">開始日期</label>
            <input
              type="date"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">結束日期</label>
            <input
              type="date"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1.5">行程色標</label>
          <div className="flex gap-2">
            {BAND_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setBandColor(c)}
                className={`w-7 h-7 rounded-full ${bandColor === c ? "ring-2 ring-offset-2 ring-slate-400" : ""}`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} type="button">
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
