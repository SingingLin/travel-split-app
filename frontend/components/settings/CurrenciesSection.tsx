"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/components/Card";
import ConfirmButton from "@/components/ConfirmButton";
import { createCurrency, deleteCurrency, updateCurrency, changeBaseCurrency, getCurrencyRates, ApiError } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import { CURATED_CURRENCIES, formatCurrencyOption } from "@/lib/currencies";
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
  const { showToast } = useToast();
  const [code, setCode] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingRates, setEditingRates] = useState<Record<number, string>>({});
  const [switchingBaseId, setSwitchingBaseId] = useState<number | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // Bulk rate lookup state: fetched once (trip-independent — see
  // GET /api/currencies/rates docstring) whenever the trip's base currency
  // changes, so picking a currency from the dropdown fills the rate
  // instantly, no per-selection API call.
  const [allRates, setAllRates] = useState<Record<string, number> | null>(null);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesError, setRatesError] = useState<string | null>(null);

  const baseCode = trip.currencies.find((c) => c.is_base)?.code ?? trip.base_currency_code;

  // Fetch-on-mount/baseCode-change with a loading flag — intentional, not a
  // cascading-render bug (fetchAllRates is a stable useCallback keyed by
  // baseCode; see TripContext.tsx's reload() for the same pattern).
  const fetchAllRates = useCallback(() => {
    let cancelled = false;
    setRatesLoading(true);
    setRatesError(null);
    getCurrencyRates(baseCode)
      .then((res) => {
        if (cancelled) return;
        setAllRates(res.rates);
      })
      .catch((e) => {
        if (cancelled) return;
        setAllRates(null);
        setRatesError(
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : "自動抓匯率清單失敗，請手動輸入幣別代碼與匯率"
        );
      })
      .finally(() => {
        if (!cancelled) setRatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseCode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    return fetchAllRates();
  }, [fetchAllRates]);

  const sorted = [...trip.currencies].sort((a, b) => (b.is_base ? 1 : 0) - (a.is_base ? 1 : 0));
  const excludeCodes = new Set([baseCode, ...trip.currencies.map((c) => c.code)]);
  const currencyOptions = CURATED_CURRENCIES.filter((c) => !excludeCodes.has(c.code));

  const add = async () => {
    const rateNum = parseFloat(rate);
    if (!code.trim() || !rateNum || rateNum <= 0) {
      setAddError("請選擇幣別並輸入有效匯率");
      return;
    }
    setAddError(null);
    setBusy(true);
    try {
      const option = CURATED_CURRENCIES.find((c) => c.code === code);
      await createCurrency(trip.id, { code: code.trim().toUpperCase(), name: option?.name ?? code.trim().toUpperCase(), rate_to_base: rateNum });
      setCode("");
      setRate("");
      onChanged();
      showToast(`已新增幣別「${code}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "新增幣別失敗", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, currencyCode: string) => {
    try {
      await deleteCurrency(id);
      onChanged();
      showToast(`已刪除幣別「${currencyCode}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "刪除幣別失敗（可能已被支出使用）", "error");
    }
  };

  // Radio-select-to-switch: clicking a non-base row's radio directly fires
  // the existing PUT /api/trips/{trip_id}/base-currency endpoint — no
  // separate "基準幣別" field anywhere else needed (see design note in
  // TripInfoSection.tsx, which used to duplicate this control).
  const setBase = async (id: number, currencyCode: string) => {
    if (switchingBaseId) return;
    setSwitchingBaseId(id);
    try {
      await changeBaseCurrency(trip.id, id);
      onChanged();
      showToast(`已將基準幣切換為「${currencyCode}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "切換基準幣失敗", "error");
    } finally {
      setSwitchingBaseId(null);
    }
  };

  const onSelectCode = (value: string) => {
    setCode(value);
    if (value && allRates && allRates[value] !== undefined) {
      setRate(String(allRates[value]));
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
      showToast("已更新匯率");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新匯率失敗", "error");
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
            <th className="pb-1.5 border-b border-slate-200 w-8" />
            <th className="pb-1.5 border-b border-slate-200">幣別</th>
            <th className="pb-1.5 border-b border-slate-200 text-right">匯率</th>
            <th className="pb-1.5 border-b border-slate-200 w-14" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id} className="border-b border-slate-100">
              <td className="py-2">
                <input
                  type="radio"
                  name="base-currency"
                  checked={c.is_base}
                  disabled={switchingBaseId !== null}
                  onChange={() => setBase(c.id, c.code)}
                  aria-label={`將「${c.code}」設為基準幣`}
                  className="w-3.5 h-3.5 accent-teal-600 cursor-pointer disabled:cursor-not-allowed"
                />
              </td>
              <td className="py-2 text-slate-700">
                {c.code} {c.name}
                {c.is_base && (
                  <span className="ml-1.5 text-[10px] bg-teal-50 text-teal-600 rounded-full px-1.5 py-0.5 font-semibold">
                    基準幣
                  </span>
                )}
                {switchingBaseId === c.id && <span className="ml-1.5 text-[10px] text-slate-400">切換中…</span>}
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
                  <ConfirmButton
                    message={`確定要刪除幣別「${c.code}」嗎？若已被支出使用，刪除將會失敗。`}
                    onConfirm={() => remove(c.id, c.code)}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    ✕
                  </ConfirmButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ratesError && (
        <p className="text-[11.5px] text-amber-600 mt-2">
          {ratesError}（已切換為手動輸入匯率模式）
        </p>
      )}
      <div className="flex gap-2 mt-3 flex-wrap">
        <select
          className="flex-1 min-w-[140px] border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          value={code}
          onChange={(e) => onSelectCode(e.target.value)}
        >
          <option value="">{ratesLoading ? "查詢匯率中…" : "選擇幣別…"}</option>
          {currencyOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {formatCurrencyOption(c)}
            </option>
          ))}
        </select>
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
      {addError && <p className="text-[11.5px] text-rose-600 mt-1.5">{addError}</p>}
    </Wrapper>
  );
}
