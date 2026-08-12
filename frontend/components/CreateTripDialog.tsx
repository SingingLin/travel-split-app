"use client";

import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { Plus, X } from "lucide-react";
import { createTrip, createMember, createCurrency, getCurrencyRates, ApiError } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import { CURATED_CURRENCIES, formatCurrencyOption } from "@/lib/currencies";
import type { TripDetail } from "@/lib/types";

/** Keeps only digits and at most one decimal point — replaces the native
 * `<input type="number">`'s own filtering so a plain `type="text"` input can
 * still only ever hold a valid decimal string, without that control's
 * mouse-wheel-silently-changes-the-value trap (see
 * uiux-audit-2026-08-12.md §3.2). Used by every rate field below. */
function filterDecimalInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

interface DraftMember {
  id: number;
  name: string;
}

interface DraftCurrency {
  id: number;
  code: string;
  name: string;
  /** Ignored/display-only ("1.00000") while isBase is true. */
  rate: string;
  isBase: boolean;
}

/**
 * Single-step "建立新行程" dialog: name / currencies (one unified list, radio
 * = which one is base) / members are all filled in on one screen (no
 * start/end date fields — removed per user feedback that they had no actual
 * function anywhere in the app), then "建立行程" fires the whole sequence — createTrip -> createMember
 * (loop) -> createCurrency (loop for the non-base rows) -> navigate to
 * /trips/{id} — in one submit. Replaces the earlier two-stage version
 * (create trip first, then a second screen to add members) per user
 * feedback that splitting it into stages was confusing.
 *
 * Currency block design: this used to be two separate UI concepts — a
 * standalone "基準幣別" <select> plus an independent "額外幣別" add-list.
 * Per user feedback that's confusing (two places to reason about "which
 * currency matters"), so now there's exactly one list of draft currencies;
 * each row has a radio button, and whichever row is checked is the trip's
 * base currency. There's no trip_id yet at this stage, so "which one is
 * base" is purely local draft state (draftCurrencies[i].isBase) — it only
 * becomes real on submit, when the checked row's code/name become
 * createTrip's base_currency_code/base_currency_name and every other row is
 * created afterwards via createCurrency. This mirrors CurrenciesSection.tsx's
 * now-identical radio-list UI for an already-created trip (which calls the
 * real changeBaseCurrency endpoint instead).
 *
 * Partial-failure handling: if trip creation itself fails, nothing exists
 * yet and the user just retries. If it succeeds but a later member/currency
 * call fails, the trip row *does* already exist — the dialog stays open
 * (doesn't close/navigate) and shows the error via toast so the user knows
 * what happened; per spec this is an acceptable edge case that doesn't need
 * full rollback. To avoid creating a *second* trip or duplicate
 * members/currencies on retry, already-created items are tracked by their
 * draft id and skipped on the next submit attempt.
 */
export default function CreateTripDialog({
  open,
  onClose,
  onTripCreated,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired right after the trip row is created, so callers can refresh a
   * trip list even if a later step in this same submit fails. */
  onTripCreated?: (trip: TripDetail) => void;
  /** Fired once the whole create-trip-then-members-then-currencies sequence
   * has succeeded. */
  onFinished: (trip: TripDetail) => void;
}) {
  const { showToast } = useToast();
  const nextDraftId = useRef(1);

  const [name, setName] = useState("");

  const [memberName, setMemberName] = useState("");
  const [draftMembers, setDraftMembers] = useState<DraftMember[]>([]);

  // No pre-selected base currency — per user feedback, defaulting this to
  // TWD meant users who don't actually use TWD (or forget to change it)
  // silently ended up with the wrong base. The list starts empty; the first
  // currency the user adds via the "＋ 新增" row below automatically becomes
  // the base (see addCurrency), and "建立行程" stays disabled/blocked (see
  // handleSubmit's validation) until one exists.
  const [draftCurrencies, setDraftCurrencies] = useState<DraftCurrency[]>([]);
  const [extraCode, setExtraCode] = useState("");
  const [extraRate, setExtraRate] = useState("");
  const [currencyFormError, setCurrencyFormError] = useState<string | null>(null);

  const [allRates, setAllRates] = useState<Record<string, number> | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);

  // Set right before a base-currency switch so the rates-fetch effect below
  // knows to auto-refill every other row's rate against the new base once
  // the fetch resolves, instead of only doing that on first mount.
  const pendingRebaseRef = useRef(false);

  const [errors, setErrors] = useState<{ name?: string; members?: string; currencies?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  // True once the user has tried "建立行程" at least once and it was blocked
  // — the "請選擇基準幣別" hint below only switches to warning styling once
  // this is true (see uiux-audit-2026-08-12.md §2.4: showing a warning color
  // the instant the dialog opens, before the user has done anything wrong,
  // reads as "you already made a mistake"). Reset alongside everything else
  // in resetAll so reopening the dialog starts clean.
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // In-flight/partial-retry bookkeeping — see component docstring.
  const createdTripRef = useRef<TripDetail | null>(null);
  const createdMemberIdsRef = useRef<Set<number>>(new Set());
  const createdCurrencyIdsRef = useRef<Set<number>>(new Set());

  const baseDraft = draftCurrencies.find((c) => c.isBase);
  const baseCode = baseDraft?.code ?? "TWD";

  const resetAll = () => {
    setName("");
    setMemberName("");
    setDraftMembers([]);
    setDraftCurrencies([]);
    nextDraftId.current = 1;
    setExtraCode("");
    setExtraRate("");
    setCurrencyFormError(null);
    setAllRates(null);
    setRatesError(null);
    setErrors({});
    setSubmitAttempted(false);
    createdTripRef.current = null;
    createdMemberIdsRef.current = new Set();
    createdCurrencyIdsRef.current = new Set();
  };

  const handleClose = () => {
    if (submitting) return;
    resetAll();
    onClose();
  };

  // Fetch "1 <base> = ? <every other currency>" whenever the checked base
  // row's currency changes, so the extra-currency rows below can auto-fill a
  // rate the instant the user picks a code — no trip_id needed (see
  // /api/currencies/rates docstring in backend/app/routers/currencies.py).
  // Also handles the "user just switched which row is base" case: once this
  // resolves, if pendingRebaseRef is set, every non-base row's rate is
  // refreshed against the new base (best-effort — a row whose code the
  // upstream API doesn't know is left for the user to fill in manually).
  useEffect(() => {
    // No base currency chosen yet -> nothing to fetch rates against (see
    // draftCurrencies' empty-initial-state comment above).
    if (!open || !baseDraft) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dep-change with a loading/error flag, same pattern as CurrenciesSection's fetchAllRates
    setRatesError(null);
    getCurrencyRates(baseCode)
      .then((res) => {
        if (cancelled) return;
        setAllRates(res.rates);
        if (pendingRebaseRef.current) {
          pendingRebaseRef.current = false;
          setDraftCurrencies((prev) =>
            prev.map((c) => (c.isBase ? c : { ...c, rate: res.rates[c.code] !== undefined ? String(res.rates[c.code]) : "" }))
          );
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setAllRates(null);
        pendingRebaseRef.current = false;
        setRatesError(
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : "自動抓匯率失敗，請手動輸入匯率"
        );
      });
    return () => {
      cancelled = true;
    };
    // baseDraft's id (not just baseCode) is a dependency so this correctly
    // re-fires the very first time a base currency is picked even when its
    // code happens to match the unused "TWD" fallback used before that (see
    // the `baseCode` derivation above) — otherwise that transition wouldn't
    // change `baseCode`'s string value and the effect would never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, baseCode, baseDraft?.id]);

  const addMember = () => {
    const trimmed = memberName.trim();
    if (!trimmed) return;
    setDraftMembers((prev) => [...prev, { id: nextDraftId.current++, name: trimmed }]);
    setMemberName("");
    setErrors((prev) => ({ ...prev, members: undefined }));
  };
  const removeMember = (id: number) => setDraftMembers((prev) => prev.filter((m) => m.id !== id));

  const takenCodes = new Set(draftCurrencies.map((c) => c.code));
  const extraOptions = CURATED_CURRENCIES.filter((c) => !takenCodes.has(c.code));

  // Picking a currency from the dropdown used to only stage it in
  // extraCode/extraRate — the user then had to click the separate "＋新增"
  // button before it actually landed in draftCurrencies and (for the first
  // one) became the base currency, which blocked "建立行程" until that extra
  // click happened. Per uiux-audit-2026-08-12.md §3.4, selecting the very
  // first currency now adds it immediately (it becomes the base, and its
  // rate is always fixed at 1.0 so there's nothing else to wait for). Once a
  // base exists, subsequent picks still just stage into extraCode/extraRate
  // — a rate has to be supplied/confirmed for those, so "＋新增" stays the
  // explicit commit step for that case, unchanged from before.
  const onSelectExtraCode = (code: string) => {
    if (code && draftCurrencies.length === 0) {
      addCurrency(code, "1");
      return;
    }
    setExtraCode(code);
    if (code && allRates && allRates[code] !== undefined) {
      setExtraRate(String(allRates[code]));
    } else {
      setExtraRate("");
    }
  };

  const addCurrency = (codeOverride?: string, rateOverride?: string) => {
    const code = codeOverride ?? extraCode;
    if (!code) return;
    // The very first currency added becomes the trip's base automatically
    // (there's nothing to "convert against" until one exists) — its rate is
    // always 1.0 and not user-editable, same as an existing trip's base row
    // in CurrenciesSection.tsx, so the rate input's value is ignored/not
    // required for this specific add. Every currency added after that is a
    // regular non-base row and still needs a valid rate, unchanged from
    // before.
    const willBeBase = draftCurrencies.length === 0;
    const rateStr = rateOverride ?? extraRate;
    const rateNum = parseFloat(rateStr);
    if (!willBeBase && (!rateNum || rateNum <= 0)) {
      setCurrencyFormError("請輸入有效的匯率");
      return;
    }
    const option = CURATED_CURRENCIES.find((c) => c.code === code);
    setDraftCurrencies((prev) => [
      ...prev,
      {
        id: nextDraftId.current++,
        code,
        name: option?.name ?? code,
        rate: willBeBase ? "1" : rateStr,
        isBase: willBeBase,
      },
    ]);
    setExtraCode("");
    setExtraRate("");
    setCurrencyFormError(null);
    setErrors((prev) => ({ ...prev, currencies: undefined }));
  };
  const removeCurrency = (id: number) => setDraftCurrencies((prev) => prev.filter((c) => c.id !== id));

  // Switching which row is the base re-anchors every other row's rate (they
  // were all expressed "units of OLD base per 1 unit of that currency" —
  // once the base changes they need to be re-expressed against the NEW
  // base). Rather than re-derive that via cross-multiplication locally, this
  // just marks pendingRebaseRef and lets the rates-fetch effect above pull
  // fresh numbers straight from the upstream API against the new base —
  // same source of truth the rest of this dialog already uses.
  const setCurrencyAsBase = (id: number) => {
    setDraftCurrencies((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target || target.isBase) return prev;
      pendingRebaseRef.current = true;
      return prev.map((c) => (c.id === id ? { ...c, isBase: true, rate: "1" } : { ...c, isBase: false }));
    });
  };

  const handleSubmit = async () => {
    setSubmitAttempted(true);
    const newErrors: typeof errors = {};
    const trimmedName = name.trim();
    if (!trimmedName) newErrors.name = "請輸入行程名稱";
    if (draftMembers.length === 0) newErrors.members = "請至少新增一位成員";
    if (!baseDraft) {
      newErrors.currencies = "請選擇基準幣別";
    } else {
      const invalidRateRow = draftCurrencies.find(
        (c) => !c.isBase && (!parseFloat(c.rate) || parseFloat(c.rate) <= 0)
      );
      if (invalidRateRow) newErrors.currencies = `幣別「${invalidRateRow.code}」的匯率無效，請修正或移除`;
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      let trip = createdTripRef.current;
      if (!trip) {
        // Guaranteed non-null: the `!baseDraft` check above already blocked
        // submission otherwise.
        trip = await createTrip({
          name: trimmedName,
          base_currency_code: baseDraft!.code,
          base_currency_name: baseDraft!.name,
        });
        createdTripRef.current = trip;
        onTripCreated?.(trip);
      }

      for (const m of draftMembers) {
        if (createdMemberIdsRef.current.has(m.id)) continue;
        await createMember(trip.id, m.name);
        createdMemberIdsRef.current.add(m.id);
      }

      for (const c of draftCurrencies) {
        if (c.isBase) continue; // base currency was already created as part of createTrip above
        if (createdCurrencyIdsRef.current.has(c.id)) continue;
        await createCurrency(trip.id, { code: c.code, name: c.name, rate_to_base: parseFloat(c.rate) });
        createdCurrencyIdsRef.current.add(c.id);
      }

      const finishedTrip = trip;
      resetAll();
      onFinished(finishedTrip);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "建立行程失敗";
      showToast(
        createdTripRef.current
          ? `行程已建立，但${message}（可再次點「建立行程」重試剩下的項目，或關閉視窗稍後到行程設定新增）`
          : message,
        "error"
      );
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

        {/* Members — required, at least one, local draft list only (no API
            call yet; created in a loop on final submit). */}
        <div>
          <label className={labelCls}>成員（至少一位）</label>
          {draftMembers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {draftMembers.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 border border-teal-200 text-teal-800 pl-3 pr-1.5 py-1 text-xs font-medium"
                >
                  {m.name}
                  <button
                    type="button"
                    onClick={() => removeMember(m.id)}
                    aria-label={`移除成員 ${m.name}`}
                    className="text-teal-500 hover:text-rose-600 leading-none inline-flex items-center"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="輸入成員姓名…"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addMember();
                }
              }}
            />
            <button
              type="button"
              onClick={addMember}
              className="border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1"
            >
              <Plus size={13} aria-hidden="true" /> 新增
            </button>
          </div>
          {errors.members && <p className="text-xs text-rose-600 mt-1">{errors.members}</p>}
        </div>

        {/* Currencies — single unified list; the radio button on a row marks
            it as the trip's base currency. Replaces the old separate
            "基準幣別" select + "額外幣別" add-list. Starts empty — no
            preselected default (see draftCurrencies' initial-state comment
            above) — the first currency added below becomes the base
            automatically. */}
        <div>
          <label className={labelCls}>
            {baseDraft ? "幣別（勾選左側圓點以指定基準幣）" : "基準幣別"}
          </label>
          {!baseDraft && (
            // Neutral/info guidance by default (sky, not amber/warning) — this
            // shows the instant the dialog opens, before the user has done
            // anything wrong, so it shouldn't look like an error (see
            // uiux-audit-2026-08-12.md §2.4). Only flips to warning styling
            // once the user has actually tried "建立行程" and been blocked by
            // this exact condition — see submitAttempted's own comment above.
            <p
              className={`text-xs rounded-lg px-3 py-2 mb-2 border ${
                submitAttempted
                  ? "text-amber-700 bg-amber-50 border-amber-200"
                  : "text-sky-700 bg-sky-50 border-sky-200"
              }`}
            >
              請選擇基準幣別 — 從下方選單挑一個幣別，這會是這趟行程的基準幣
            </p>
          )}
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 mb-2 empty:hidden">
            {draftCurrencies.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 px-3 py-2">
                <input
                  type="radio"
                  name="draft-base-currency"
                  checked={c.isBase}
                  onChange={() => setCurrencyAsBase(c.id)}
                  aria-label={`將「${c.code}」設為基準幣`}
                  className="w-3.5 h-3.5 accent-teal-600 cursor-pointer shrink-0"
                />
                <span className="text-sm text-slate-700 flex-1">
                  {c.code} {c.name}
                  {c.isBase && (
                    <span className="ml-1.5 text-[10px] bg-teal-50 text-teal-600 rounded-full px-1.5 py-0.5 font-semibold">
                      基準幣
                    </span>
                  )}
                </span>
                {c.isBase ? (
                  <span className="w-24 text-right text-xs tabular-nums text-slate-400">1.00000</span>
                ) : (
                  <input
                    className="w-24 border border-slate-300 rounded px-1.5 py-1 text-right text-xs tabular-nums"
                    type="text"
                    inputMode="decimal"
                    value={c.rate}
                    onChange={(e) => {
                      const val = filterDecimalInput(e.target.value);
                      setDraftCurrencies((prev) => prev.map((d) => (d.id === c.id ? { ...d, rate: val } : d)));
                      if (errors.currencies) setErrors((prev) => ({ ...prev, currencies: undefined }));
                    }}
                  />
                )}
                {!c.isBase && (
                  <button
                    type="button"
                    onClick={() => removeCurrency(c.id)}
                    aria-label={`移除幣別 ${c.code}`}
                    className="text-slate-400 hover:text-rose-600 leading-none shrink-0 inline-flex items-center"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              className={`${inputCls} flex-1 min-w-[140px]`}
              value={extraCode}
              onChange={(e) => onSelectExtraCode(e.target.value)}
            >
              <option value="">選擇幣別…</option>
              {extraOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {formatCurrencyOption(c)}
                </option>
              ))}
            </select>
            {draftCurrencies.length === 0 ? (
              // The first currency added becomes the base -> its rate is
              // always fixed at 1.0, not user-entered (see addCurrency).
              <span className="w-28 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-400 text-right tabular-nums">
                1.00000
              </span>
            ) : (
              <input
                className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                placeholder="匯率"
                type="text"
                inputMode="decimal"
                value={extraRate}
                onChange={(e) => {
                  setExtraRate(filterDecimalInput(e.target.value));
                  if (currencyFormError) setCurrencyFormError(null);
                }}
              />
            )}
            <button
              type="button"
              onClick={() => addCurrency()}
              className="border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1"
            >
              <Plus size={13} aria-hidden="true" /> 新增
            </button>
          </div>
          {currencyFormError && <p className="text-xs text-rose-600 mt-1">{currencyFormError}</p>}
          {errors.currencies && <p className="text-xs text-rose-600 mt-1">{errors.currencies}</p>}
          {ratesError && (
            <p className="text-[11px] text-amber-600 mt-1.5">{ratesError}（已切換為手動輸入匯率）</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={handleClose} type="button" disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || draftMembers.length === 0 || !baseDraft}
            title={!baseDraft ? "請先選擇基準幣別" : undefined}
            type="button"
          >
            {submitting ? "建立中…" : "建立行程"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
