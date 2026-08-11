"use client";

import { useState } from "react";
import Card from "@/components/Card";
import { createCurrency, deleteCurrency, updateCurrency } from "@/lib/api";
import type { TripDetail } from "@/lib/types";

export default function CurrenciesSection({
  trip,
  onChanged,
  bare = false,
}: {
  trip: TripDetail;
  onChanged: () => void;
  bare?: boolean;
}) {
  const [code, setCode] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingRates, setEditingRates] = useState<Record<number, string>>({});

  const baseCode = trip.currencies.find((c) => c.is_base)?.code ?? trip.base_currency_code;
  const sorted = [...trip.currencies].sort((a, b) => (b.is_base ? 1 : 0) - (a.is_base ? 1 : 0));

  const add = async () => {
    const rateNum = parseFloat(rate);
    if (!code.trim() || !rateNum || rateNum <= 0) {
      setError("請輸入幣別代碼與有效匯率");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createCurrency(trip.id, { code: code.trim().toUpperCase(), name: code.trim().toUpperCase(), rate_to_base: rateNum });
      setCode("");
      setRate("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增幣別失敗");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteCurrency(id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除幣別失敗（可能已被支出使用）");
    }
  };

  const commitRate = async (id: number) => {
    const val = editingRates[id];
    if (val === undefined) return;
    const num = parseFloat(val);
    if (!num || num <= 0) return;
    try {
      await updateCurrency(id, { rate_to_base: num });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新匯率失敗");
    }
  };

  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper id="section-currencies">
      {!bare && <p className="text-sm md:text-base font-semibold text-slate-900 mb-0.5">幣別匯率</p>}
      <p className="text-[11px] text-slate-400 mb-3">對基準幣（{baseCode}），修改匯率不會回溯改變過去支出的換算結果</p>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] text-slate-400 font-semibold uppercase">
            <th className="pb-1.5 border-b border-slate-200">幣別</th>
            <th className="pb-1.5 border-b border-slate-200 text-right">匯率</th>
            <th className="pb-1.5 border-b border-slate-200 w-14" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id} className="border-b border-slate-100">
              <td className="py-2 text-slate-700">
                {c.code} {c.name}
                {c.is_base && (
                  <span className="ml-1.5 text-[10px] bg-teal-50 text-teal-600 rounded-full px-1.5 py-0.5 font-semibold">
                    基準幣
                  </span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums">
                {c.is_base ? (
                  "1.00000"
                ) : (
                  <input
                    className="w-24 border border-slate-300 rounded px-1.5 py-1 text-right text-xs tabular-nums"
                    defaultValue={c.rate_to_base}
                    onChange={(e) => setEditingRates((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    onBlur={() => commitRate(c.id)}
                  />
                )}
              </td>
              <td className="py-2 text-right">
                {!c.is_base && (
                  <button onClick={() => remove(c.id)} className="text-slate-400 hover:text-rose-600">
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      <div className="flex gap-2 mt-3">
        <input
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          placeholder="幣別代碼，如 JPY"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          placeholder="匯率"
          type="number"
          step="0.00001"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
        />
        <button
          onClick={add}
          disabled={busy}
          className="border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap"
        >
          ＋ 新增幣別
        </button>
      </div>
    </Wrapper>
  );
}
