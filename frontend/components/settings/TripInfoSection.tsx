"use client";

import { useState } from "react";
import Card from "@/components/Card";
import Button from "@/components/Button";
import { changeBaseCurrency, updateTrip } from "@/lib/api";
import type { TripDetail } from "@/lib/types";

export default function TripInfoSection({
  trip,
  onChanged,
  bare = false,
}: {
  trip: TripDetail;
  onChanged: () => void;
  bare?: boolean;
}) {
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(trip.start_date ?? "");
  const [endDate, setEndDate] = useState(trip.end_date ?? "");
  const [baseCurrencyId, setBaseCurrencyId] = useState<number>(
    trip.currencies.find((c) => c.is_base)?.id ?? trip.currencies[0]?.id ?? 0
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";

  const currentBase = trip.currencies.find((c) => c.is_base);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (baseCurrencyId !== currentBase?.id) {
        await changeBaseCurrency(trip.id, baseCurrencyId);
      }
      await updateTrip(trip.id, {
        name,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper id="section-info">
      {!bare && <p className="text-sm md:text-base font-semibold text-slate-900 mb-3">行程資訊</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[11.5px] text-slate-500 mb-1">行程名稱</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11.5px] text-slate-500 mb-1">
            基準幣別
            <span className="text-slate-400 font-normal"> · 變更會重新換算所有匯率，不影響歷史換算金額</span>
          </label>
          <select
            className={inputCls}
            value={baseCurrencyId}
            onChange={(e) => setBaseCurrencyId(Number(e.target.value))}
          >
            {trip.currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[11.5px] text-slate-500 mb-1">開始日期</label>
          <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11.5px] text-slate-500 mb-1">結束日期</label>
          <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-sm text-rose-600 mb-2">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "儲存中…" : "儲存變更"}
        </Button>
      </div>
    </Wrapper>
  );
}
