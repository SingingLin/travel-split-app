"use client";

import { useEffect, useRef, useState } from "react";
import Card from "@/components/Card";
import { ArrowRight } from "lucide-react";
import { getCurrencyRates, updateTrip } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import { CURATED_CURRENCIES, formatCurrencyOption } from "@/lib/currencies";
import type { TripDetail } from "@/lib/types";

/** Keeps only digits and at most one decimal point — replaces the native
 * `<input type="number">`'s own filtering so a plain `type="text"` input can
 * still only ever hold a valid decimal string, without that control's
 * mouse-wheel-silently-changes-the-value trap (see
 * uiux-audit-2026-08-12.md §3.2). Used by every amount/rate field below. */
function filterDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

/** Parses a raw input string into a positive-or-zero number, or null for an
 * empty/blank string, or NaN for anything else unparseable — callers treat
 * NaN as "invalid, block the save" and null as "field intentionally empty". */
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

/** Rounds a computed convenience-default amount to a sane number of decimals
 * for a plain-text <input> — 2dp for money amounts (matches formatMoney's
 * default precision), and strips a redundant ".00" so e.g. 700 shows as
 * "700" not "700.00" (the field stays a normal editable number either way). */
function roundAmountForInput(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** Same idea as roundAmountForInput but keeps more precision (6dp) — rates
 * for some currency pairs are small (e.g. 1 IDR ≈ 0.002 TWD) and lose
 * meaningful precision at 2dp. Matches this app's existing rate-precision
 * conventions elsewhere (CurrenciesSection/CreateTripDialog use
 * step="0.00001"). */
function roundRateForInput(n: number): string {
  return (Math.round(n * 1e6) / 1e6).toString();
}

/**
 * Trip name + base currency display and the initial-exchange record. (The
 * "危險區塊"/delete-trip card used to live at the bottom of this same
 * component — it's now its own DangerZoneSection, rendered separately at the
 * very bottom of the settings page; see uiux-audit-2026-08-12.md §1.7.)
 * Auto-saves on blur/select (no standalone "儲存" button) so the whole
 * 行程設定 page behaves consistently — every other section here (Members/
 * Currencies/Categories/PaymentMethods) already commits each change
 * immediately via its create/update/delete API call + a toast, per earlier
 * user feedback that a single "改完立刻生效" model is easier to learn than
 * mixing that with a section that still needs an explicit save button.
 * Mirrors MembersSection.tsx's inline-rename pattern (click-to-edit,
 * blur/Enter commits, Escape/empty reverts).
 *
 * Start/end date fields were removed from this form (and from
 * CreateTripDialog/TripCard) per user feedback that they had no actual
 * function (no sorting/filtering/behavior ever depended on them) — the
 * backend Trip.start_date/end_date columns and API fields are intentionally
 * left in place (this project has no formal migration tooling; dropping
 * columns is unnecessary risk), they simply never get written to anymore.
 *
 * The single "初始換匯金額" input (trip.initial_budget, always in
 * base_currency_code) has been superseded by a full "初始換匯" record: which
 * currency the money started as, which currency it was exchanged into (the
 * one actually carried while traveling), and the actual historical rate —
 * see models.Trip's docstring for the five initial_exchange_* fields and
 * their direction convention. trip.initial_budget itself is left untouched
 * (unused going forward) per this project's no-migration-tooling policy.
 */
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
  const [saving, setSaving] = useState(false);

  // "前往切換" for the read-only 基準幣別 field below — scrolls to
  // CurrenciesSection's card (id="section-currencies", rendered by a sibling
  // component in SettingsPageClient) and briefly highlights it, per
  // uiux-audit-2026-08-12.md §1.3/§1.4: this field used to look like a
  // clickable dropdown but silently did nothing, so switching the base
  // currency needs an explicit, working entry point. Plain DOM lookup (not a
  // ref) since CurrenciesSection isn't a child of this component — same
  // approach as SettingsPageClient's own `#section-xxx` anchor nav links. On
  // mobile, if that section's accordion happens to be collapsed the card
  // isn't mounted yet and this is a no-op; the user can still open it
  // manually from the accordion list right below.
  const goToCurrencySwitch = () => {
    const el = document.getElementById("section-currencies");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-teal-400", "ring-offset-2");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-teal-400", "ring-offset-2");
    }, 1600);
  };
  const [nameError, setNameError] = useState<string | null>(null);
  const { showToast } = useToast();
  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";
  const selectCls = `${inputCls} bg-white`;

  // Keep the local input synced with the trip prop when it changes from
  // outside (e.g. reload() after another section's edit) — but not while
  // the user is actively focused/typing in this field, so an unrelated
  // reload elsewhere on the page can't clobber an in-progress edit.
  const isEditingRef = useRef(false);
  useEffect(() => {
    if (!isEditingRef.current) setName(trip.name);
  }, [trip.name]);

  const commitName = async () => {
    isEditingRef.current = false;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("請輸入行程名稱");
      setName(trip.name);
      return;
    }
    if (trimmed === trip.name) {
      setName(trimmed);
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      await updateTrip(trip.id, { name: trimmed });
      onChanged();
      showToast("行程名稱已更新");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新行程名稱失敗", "error");
      setName(trip.name);
    } finally {
      setSaving(false);
    }
  };

  // ---------- 初始換匯紀錄 ----------
  // Five independently-editable fields (see models.Trip docstring). Kept as
  // raw strings (not numbers) so a field can hold an empty/in-progress value
  // without fighting the user's typing, same pattern as ExpenseFormDialog's
  // amount fields. fromCurrency used to default to the trip's base currency
  // when no record exists yet, but that collided with 換入幣別 in
  // single-currency trips (换出/换入 defaulting to the same code trips
  // straight into the "不能相同" validation error before the user has even
  // touched the field) — per uiux-audit-2026-08-12.md §3.6 it now starts
  // blank and the user picks it explicitly; nothing is saved until the user
  // actually fills in an amount/blurs a field.
  const [fromCurrency, setFromCurrency] = useState(trip.initial_exchange_from_currency ?? "");
  const [fromAmount, setFromAmount] = useState(
    trip.initial_exchange_from_amount != null ? String(trip.initial_exchange_from_amount) : ""
  );
  const [toCurrency, setToCurrency] = useState(trip.initial_exchange_to_currency ?? "");
  const [toAmount, setToAmount] = useState(
    trip.initial_exchange_to_amount != null ? String(trip.initial_exchange_to_amount) : ""
  );
  const [rate, setRate] = useState(trip.initial_exchange_rate != null ? String(trip.initial_exchange_rate) : "");
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const [exchangeSaving, setExchangeSaving] = useState(false);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  const isEditingExchangeRef = useRef(false);
  useEffect(() => {
    if (isEditingExchangeRef.current) return;
    setFromCurrency(trip.initial_exchange_from_currency ?? "");
    setFromAmount(trip.initial_exchange_from_amount != null ? String(trip.initial_exchange_from_amount) : "");
    setToCurrency(trip.initial_exchange_to_currency ?? "");
    setToAmount(trip.initial_exchange_to_amount != null ? String(trip.initial_exchange_to_amount) : "");
    setRate(trip.initial_exchange_rate != null ? String(trip.initial_exchange_rate) : "");
  }, [
    trip.initial_exchange_from_currency,
    trip.initial_exchange_from_amount,
    trip.initial_exchange_to_currency,
    trip.initial_exchange_to_amount,
    trip.initial_exchange_rate,
    trip.base_currency_code,
  ]);

  const resetExchangeFields = () => {
    setFromCurrency(trip.initial_exchange_from_currency ?? "");
    setFromAmount(trip.initial_exchange_from_amount != null ? String(trip.initial_exchange_from_amount) : "");
    setToCurrency(trip.initial_exchange_to_currency ?? "");
    setToAmount(trip.initial_exchange_to_amount != null ? String(trip.initial_exchange_to_amount) : "");
    setRate(trip.initial_exchange_rate != null ? String(trip.initial_exchange_rate) : "");
  };

  /** Commits the current (or overridden) draft to the backend. Accepts
   * overrides because the currency <select>s commit immediately on change
   * (mirroring CurrenciesSection's base-currency radio pattern) — at that
   * point React's setFromCurrency/setToCurrency call hasn't necessarily been
   * reflected in `fromCurrency`/`toCurrency` yet, so the just-picked value is
   * passed straight through instead of read from state. `notify=false` is
   * used for saves that happen as a side effect of an unrelated action
   * (currency pick auto-committing, or the suggested-rate fetch persisting
   * its own default) so the user doesn't see a toast for every intermediate
   * step of filling in this multi-field record. */
  const commitExchange = async (
    overrides: Partial<{
      fromCurrency: string;
      fromAmount: string;
      toCurrency: string;
      toAmount: string;
      rate: string;
    }> = {},
    notify = true
  ) => {
    isEditingExchangeRef.current = false;
    const draft = {
      fromCurrency: (overrides.fromCurrency ?? fromCurrency).trim().toUpperCase(),
      fromAmount: overrides.fromAmount ?? fromAmount,
      toCurrency: (overrides.toCurrency ?? toCurrency).trim().toUpperCase(),
      toAmount: overrides.toAmount ?? toAmount,
      rate: overrides.rate ?? rate,
    };

    if (draft.fromCurrency && draft.toCurrency && draft.fromCurrency === draft.toCurrency) {
      setExchangeError("換出與換入幣別不能相同，若整趟行程只使用一種幣別，這個欄位可以留空不填");
      resetExchangeFields();
      return;
    }
    const fAmt = parseAmount(draft.fromAmount);
    const tAmt = parseAmount(draft.toAmount);
    const r = parseAmount(draft.rate);
    if (fAmt !== null && (Number.isNaN(fAmt) || fAmt < 0)) {
      setExchangeError("換出金額請輸入 0 以上的數字");
      resetExchangeFields();
      return;
    }
    if (tAmt !== null && (Number.isNaN(tAmt) || tAmt < 0)) {
      setExchangeError("換入金額請輸入 0 以上的數字");
      resetExchangeFields();
      return;
    }
    if (r !== null && (Number.isNaN(r) || r <= 0)) {
      setExchangeError("匯率請輸入大於 0 的數字");
      resetExchangeFields();
      return;
    }

    const nextPayload = {
      initial_exchange_from_currency: draft.fromCurrency || null,
      initial_exchange_from_amount: fAmt,
      initial_exchange_to_currency: draft.toCurrency || null,
      initial_exchange_to_amount: tAmt,
      initial_exchange_rate: r,
    };
    const unchanged =
      nextPayload.initial_exchange_from_currency === (trip.initial_exchange_from_currency ?? null) &&
      nextPayload.initial_exchange_from_amount === trip.initial_exchange_from_amount &&
      nextPayload.initial_exchange_to_currency === (trip.initial_exchange_to_currency ?? null) &&
      nextPayload.initial_exchange_to_amount === trip.initial_exchange_to_amount &&
      nextPayload.initial_exchange_rate === trip.initial_exchange_rate;
    if (unchanged) return;

    setExchangeError(null);
    setExchangeSaving(true);
    try {
      await updateTrip(trip.id, nextPayload);
      onChanged();
      if (notify) showToast("初始換匯紀錄已更新");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新初始換匯紀錄失敗", "error");
      resetExchangeFields();
    } finally {
      setExchangeSaving(false);
    }
  };

  /** Fetches "1 <toCode> = ? <fromCode>" (exactly this record's rate
   * direction — see getCurrencyRates docstring for why base=fromCode gives
   * this directly, no inversion needed) and fills it in as a convenience
   * default the moment both currencies are known. Never fired on mount/prop
   * sync — only from the two currency <select>s' onChange handlers below —
   * so an already-saved historical rate is never silently clobbered by a
   * live-rate refetch just because the trip data reloaded. */
  const fetchSuggestedRate = async (fromCode: string, toCode: string) => {
    if (!fromCode || !toCode || fromCode === toCode) return;
    setRateLoading(true);
    setRateNotice(null);
    try {
      const res = await getCurrencyRates(fromCode);
      const suggested = res.rates[toCode];
      if (suggested === undefined || suggested <= 0) {
        setRateNotice("查無此幣別組合的即時匯率，請手動輸入");
        return;
      }
      const suggestedRateStr = roundRateForInput(suggested);
      setRate(suggestedRateStr);
      let suggestedToAmountStr = toAmount;
      const f = parseAmount(fromAmount);
      if (f != null && !Number.isNaN(f) && f > 0) {
        suggestedToAmountStr = roundAmountForInput(f / suggested);
        setToAmount(suggestedToAmountStr);
      }
      setRateNotice(
        `已帶入今日即時匯率（1 ${toCode} ≈ ${suggestedRateStr} ${fromCode}）作為預設建議，你可以自行改成當初實際換到的匯率`
      );
      // Persist the freshly-suggested rate/amount too, so navigating away
      // right after picking currencies doesn't lose this default (it was
      // never typed by the user, so no keystroke will trigger a blur-save).
      commitExchange({ fromCurrency: fromCode, toCurrency: toCode, rate: suggestedRateStr, toAmount: suggestedToAmountStr }, false);
    } catch {
      setRateNotice("自動抓即時匯率失敗，請手動輸入匯率");
    } finally {
      setRateLoading(false);
    }
  };

  // ---------- "填任兩個，帶出第三個" 方便輸入 ----------
  // Each handler recomputes exactly one of the other two number fields (using
  // whichever of them already holds a usable value as the anchor), purely as
  // an inline convenience default — every field stays fully editable
  // afterward, and whatever's actually left in the field at commit time
  // (blur) is what gets saved. Never runs in the background independent of
  // the user's own typing.
  const onFromAmountChange = (v: string) => {
    setFromAmount(v);
    if (exchangeError) setExchangeError(null);
    const f = parseAmount(v);
    if (f == null || Number.isNaN(f) || f <= 0) return;
    const r = parseAmount(rate);
    if (r != null && !Number.isNaN(r) && r > 0) {
      setToAmount(roundAmountForInput(f / r));
      return;
    }
    const t = parseAmount(toAmount);
    if (t != null && !Number.isNaN(t) && t > 0) {
      setRate(roundRateForInput(f / t));
    }
  };

  const onToAmountChange = (v: string) => {
    setToAmount(v);
    if (exchangeError) setExchangeError(null);
    const t = parseAmount(v);
    if (t == null || Number.isNaN(t) || t <= 0) return;
    const r = parseAmount(rate);
    if (r != null && !Number.isNaN(r) && r > 0) {
      setFromAmount(roundAmountForInput(t * r));
      return;
    }
    const f = parseAmount(fromAmount);
    if (f != null && !Number.isNaN(f) && f > 0) {
      setRate(roundRateForInput(f / t));
    }
  };

  const onRateChange = (v: string) => {
    setRate(v);
    if (exchangeError) setExchangeError(null);
    const r = parseAmount(v);
    if (r == null || Number.isNaN(r) || r <= 0) return;
    const f = parseAmount(fromAmount);
    if (f != null && !Number.isNaN(f) && f > 0) {
      setToAmount(roundAmountForInput(f / r));
      return;
    }
    const t = parseAmount(toAmount);
    if (t != null && !Number.isNaN(t) && t > 0) {
      setFromAmount(roundAmountForInput(t * r));
    }
  };

  const onFromCurrencyChange = (v: string) => {
    setFromCurrency(v);
    if (exchangeError) setExchangeError(null);
    commitExchange({ fromCurrency: v });
    fetchSuggestedRate(v, toCurrency);
  };

  const onToCurrencyChange = (v: string) => {
    setToCurrency(v);
    if (exchangeError) setExchangeError(null);
    commitExchange({ toCurrency: v });
    fetchSuggestedRate(fromCurrency, v);
  };

  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper id="section-info">
      {!bare && <p className="text-sm md:text-base font-semibold text-slate-900 mb-3">行程資訊</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11.5px] text-slate-500 mb-1">行程名稱</label>
          <input
            className={inputCls}
            value={name}
            disabled={saving}
            onFocus={() => {
              isEditingRef.current = true;
            }}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(trip.name);
                setNameError(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {nameError && <p className="text-xs text-rose-600 mt-1">{nameError}</p>}
        </div>
        <div>
          <label className="block text-[11.5px] text-slate-500 mb-1">基準幣別</label>
          {/* Deliberately NOT styled like an input (no border/box) — this
              value is read-only here; per uiux-audit-2026-08-12.md §1.3 the
              old bordered-box treatment made it look like a clickable
              dropdown that just silently did nothing when clicked. */}
          <div className="flex items-center gap-2 py-2">
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold bg-teal-50 text-teal-700">
              {trip.base_currency_code}
            </span>
            <button
              type="button"
              onClick={goToCurrencySwitch}
              className="text-xs text-teal-600 hover:text-teal-700 font-medium inline-flex items-center gap-0.5"
            >
              前往切換 <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
          <p className="text-[11px] text-slate-400">於下方「幣別匯率」清單切換基準幣</p>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11.5px] text-slate-500 mb-1">初始換匯紀錄（選填）</label>
          <div className="border border-slate-200 rounded-lg p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">換出幣別</label>
                <select
                  className={selectCls}
                  value={fromCurrency}
                  disabled={exchangeSaving}
                  onFocus={() => {
                    isEditingExchangeRef.current = true;
                  }}
                  onChange={(e) => onFromCurrencyChange(e.target.value)}
                >
                  <option value="">未選擇</option>
                  {CURATED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {formatCurrencyOption(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">換出金額</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputCls}
                  value={fromAmount}
                  disabled={exchangeSaving}
                  placeholder="例如 20899"
                  onFocus={() => {
                    isEditingExchangeRef.current = true;
                  }}
                  onChange={(e) => onFromAmountChange(filterDecimalInput(e.target.value))}
                  onBlur={() => commitExchange()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      resetExchangeFields();
                      setExchangeError(null);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-slate-300 text-xs">
              <span className="flex-1 h-px bg-slate-100" />
              換成
              <span className="flex-1 h-px bg-slate-100" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">換入幣別</label>
                <select
                  className={selectCls}
                  value={toCurrency}
                  disabled={exchangeSaving}
                  onFocus={() => {
                    isEditingExchangeRef.current = true;
                  }}
                  onChange={(e) => onToCurrencyChange(e.target.value)}
                >
                  <option value="">未選擇</option>
                  {CURATED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {formatCurrencyOption(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10.5px] text-slate-400 mb-1">換入金額（實際帶去旅行用的錢）</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={inputCls}
                  value={toAmount}
                  disabled={exchangeSaving}
                  placeholder="例如 700"
                  onFocus={() => {
                    isEditingExchangeRef.current = true;
                  }}
                  onChange={(e) => onToAmountChange(filterDecimalInput(e.target.value))}
                  onBlur={() => commitExchange()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      resetExchangeFields();
                      setExchangeError(null);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10.5px] text-slate-400 mb-1">
                換匯匯率（1 {toCurrency || "換入幣別"} ≈ ? {fromCurrency || "換出幣別"}）
                {rateLoading && <span className="ml-1.5 text-slate-400">查詢即時匯率中…</span>}
              </label>
              <input
                type="text"
                inputMode="decimal"
                className={`${inputCls} max-w-[200px]`}
                value={rate}
                disabled={exchangeSaving}
                placeholder="當初實際換到的匯率"
                onFocus={() => {
                  isEditingExchangeRef.current = true;
                }}
                onChange={(e) => onRateChange(filterDecimalInput(e.target.value))}
                onBlur={() => commitExchange()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") {
                    resetExchangeFields();
                    setExchangeError(null);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              {rateNotice && <p className="text-[10.5px] text-slate-400 mt-1">{rateNotice}</p>}
            </div>

            {exchangeError && <p className="text-xs text-rose-600">{exchangeError}</p>}
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
