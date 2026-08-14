"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import Avatar from "./Avatar";
import Select from "./Select";
import {
  createExpense,
  splitPreview,
  updateExpense,
  createMember,
  createCurrency,
  createCategory,
  createPaymentMethod,
  getCurrencyRates,
  uploadExpenseImage,
  API_BASE,
  ApiError,
} from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import { CURATED_CURRENCIES, formatCurrencyOption } from "@/lib/currencies";
import type { Expense, ExpenseShareInput, ExpenseType, TripDetail } from "@/lib/types";

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

// Name of the payment method that unlocks the "海外手續費" field — matches
// the seeded default in backend/app/constants.py (DEFAULT_PAYMENT_METHODS);
// user-renamed/custom payment methods simply won't match, same as any other
// name-based UI affordance in this app.
const CREDIT_CARD_PAYMENT_METHOD_NAME = "信用卡";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Single source of truth for "what should the 匯率 field show for this
 * currency by default" — a trip's base currency is always pinned to "1"
 * (same rule CurrenciesSection.tsx applies to the base row), every other
 * currency shows its own current rate_to_base. Used by every place that
 * needs to (re)compute this default: the form's initial state, the
 * open/reset effect, and the currency-<select>'s onChange below — kept as
 * one function specifically so those three call sites can never drift apart
 * and independently reintroduce a wrong/stale rate (e.g. one of them
 * accidentally computing a ratio against a *different* currency instead of
 * just reading this currency's own rate_to_base). */
function defaultRateForCurrency(currency: { is_base: boolean; rate_to_base: number } | undefined): string {
  return currency?.is_base ? "1" : String(currency?.rate_to_base ?? 1);
}

/** Inline "＋ 新增…" sub-form shown in place of a <select> when the user picks
 * its "＋ 新增X…" option — used by payer/currency/category/payment-method
 * fields below so a missing option can be created without leaving the form
 * (see ExpenseFormDialog's addingField state). */
function InlineAddRow({
  placeholder,
  value,
  onChange,
  onConfirm,
  onCancel,
  busy,
  error,
  extra,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  /** Extra field rendered above the confirm/cancel buttons (currency's code
   * select + rate input goes here instead of replacing the name input). */
  extra?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {extra ?? (
        <input
          autoFocus
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm();
            }
            if (e.key === "Escape") onCancel();
          }}
        />
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-2 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? "新增中…" : "確認新增"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-slate-300 text-slate-500 hover:bg-slate-50 rounded-lg px-2 py-1.5 text-xs"
        >
          取消
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}

type AddField = "payer" | "currency" | "category" | "paymentMethod" | null;

/** Three explicit split modes, replacing the old implicit "equal button +
 * always-editable amount inputs" combo:
 *  - "equal": amounts are computed by the backend's equal_split (largest-
 *    remainder rounding) and read-only here — this IS the '平均分攤' button's
 *    old behavior, just continuous instead of a one-shot recompute action.
 *  - "custom": user types each selected member's amount by hand (unchanged
 *    from the old always-on manual editing).
 *  - "shares": user types a per-member positive-integer "share count"
 *    (defaults to 1) instead of an amount; amounts are computed by the
 *    backend's weighted_split and shown read-only next to the share count.
 * Whichever mode was used, submit always sends the resulting `shares:
 * [{member_id, amount, is_settled}]` — the backend doesn't need to know
 * which mode produced those numbers (see split.py / routers/expenses.py). */
type SplitMode = "equal" | "custom" | "shares";

export default function ExpenseFormDialog({
  open,
  onClose,
  tripId,
  trip,
  expense,
  onSaved,
  onTripChanged,
}: {
  open: boolean;
  onClose: () => void;
  tripId: number;
  trip: TripDetail;
  expense?: Expense | null;
  onSaved: (expense: Expense) => void;
  /** Called right after a member/currency/category/payment-method is created
   * via one of this form's inline "＋ 新增…" flows, so the caller can reload
   * `trip` — the newly-created id is already selected locally (see the
   * confirmAddXxx handlers below), so once the reloaded `trip` prop arrives
   * it just appears as a valid, already-selected option. */
  onTripChanged?: () => void;
}) {
  const { showToast } = useToast();
  const isEdit = !!expense;
  // A "contributor" (guest — see backend models.TripAccess's docstring) may
  // only create a brand-new expense using the trip's EXISTING payer/currency
  // /category/payment-method options — every "＋ 新增…" quick-add flow below
  // ultimately calls a create* endpoint gated by require_edit_access, which
  // 403s a contributor (see backend app/auth.py check_edit_access). Those
  // options used to still render for a contributor and only fail after the
  // click; this hides them from the dropdown entirely instead, since
  // there's nothing a contributor can actually do with them.
  const canQuickAdd = trip.my_role !== "contributor";
  const baseCurrency = trip.currencies.find((c) => c.is_base) ?? trip.currencies[0];
  // Splitting a single-member trip's expense across "everyone" is a no-op —
  // per user feedback, don't even show the toggle in that case (forced off).
  const canSplit = trip.members.length > 1;

  // "expense" (default) | "income" — top-of-form tab, see the tab buttons in
  // the JSX below. Drives: the payload's `type`, the 付款人/收款人 label,
  // and the blank-name fallback ("支出"/"收入", resolved server-side).
  const [expenseType, setExpenseType] = useState<ExpenseType>(expense?.type ?? "expense");
  const [date, setDate] = useState(expense?.date ?? todayIso());
  const [categoryId, setCategoryId] = useState<number | null>(
    expense?.category_id ?? trip.categories[0]?.id ?? null
  );
  const [name, setName] = useState(expense?.name ?? "");
  const [amount, setAmount] = useState<string>(expense ? String(expense.amount) : "");
  // Optional "海外手續費" — only shown/editable while the selected payment
  // method is 信用卡 (see isCreditCard below); cleared whenever the user
  // switches away from it so a stale fee never silently survives onto a cash
  // expense (see the 付款方式 <select>'s onChange below).
  const [foreignFee, setForeignFee] = useState<string>(
    expense?.foreign_fee != null ? String(expense.foreign_fee) : ""
  );
  const [currencyId, setCurrencyId] = useState<number>(expense?.currency_id ?? baseCurrency?.id ?? 0);
  // "生效匯率" — defaults to the selected currency's current rate_to_base
  // (or, when editing, whatever rate_snapshot was actually used at the time,
  // which may itself have been a manual override) and is user-editable
  // unless the selected currency is the trip's base (always 1.0, same rule
  // CurrenciesSection.tsx already applies to the base row). See rateOverride
  // in the submit payload below / ExpenseCreate.rate_override on the backend.
  const [rateInput, setRateInput] = useState<string>(() => {
    if (expense) return String(expense.rate_snapshot);
    const initialCurrencyId = baseCurrency?.id ?? 0;
    const initialCurrency = trip.currencies.find((c) => c.id === initialCurrencyId);
    return defaultRateForCurrency(initialCurrency);
  });
  const [payerId, setPayerId] = useState<number>(expense?.payer_id ?? trip.members[0]?.id ?? 0);
  const [paymentMethodId, setPaymentMethodId] = useState<number | null>(
    expense?.payment_method_id ?? trip.payment_methods[0]?.id ?? null
  );
  const [note, setNote] = useState(expense?.note ?? "");
  // Receipt/reference photo — "url" is what actually gets sent in the
  // payload (the backend's relative "/uploads/xxxxx.jpg"); the file picker
  // uploads immediately on selection (via uploadExpenseImage) rather than
  // deferring to form submit, so the user sees a real thumbnail/error right
  // away instead of only discovering an upload problem after hitting 儲存.
  const [imageUrl, setImageUrl] = useState<string | null>(expense?.image_url ?? null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [needsSplit, setNeedsSplit] = useState(expense?.needs_split ?? false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>(
    expense?.shares.map((s) => s.member_id) ?? trip.members.map((m) => m.id)
  );
  const [shareAmounts, setShareAmounts] = useState<Record<number, number>>(
    Object.fromEntries((expense?.shares ?? []).map((s) => [s.member_id, s.amount]))
  );
  const [shareSettled, setShareSettled] = useState<Record<number, boolean>>(
    Object.fromEntries((expense?.shares ?? []).map((s) => [s.member_id, s.is_settled]))
  );
  // Default mode: "custom" when opening an expense that already has real
  // (possibly non-equal) shares to protect — matches what's on screen so the
  // auto-recompute effects below (gated on splitMode, see their own
  // comments) don't silently overwrite them; "equal" otherwise (brand new
  // expense, or an existing expense that had never been split before), so
  // turning the split toggle on gets a nice equal-split default like before.
  const initialSplitMode = (expense?.shares.length ?? 0) > 0 ? "custom" : "equal";
  const [splitMode, setSplitMode] = useState<SplitMode>(initialSplitMode);
  // Per-member "share count" for the "依份數分攤" mode — not persisted by the
  // backend at all (only the resulting amounts are), so this always starts
  // at 1 for everyone regardless of create/edit mode; see weighted_split in
  // backend/app/services/split.py.
  const [shareCounts, setShareCounts] = useState<Record<number, number>>(
    Object.fromEntries(trip.members.map((m) => [m.id, 1]))
  );
  const [submitting, setSubmitting] = useState(false);
  // Field-level validation errors, rendered directly under each offending
  // input instead of one combined message at the bottom of the form (per
  // user feedback that a single bottom-of-form line made it hard to tell
  // which field was actually wrong).
  const [errors, setErrors] = useState<{
    amount?: string;
    foreignFee?: string;
    currencyId?: string;
    rate?: string;
    payerId?: string;
    shares?: string;
  }>({});
  const clearError = (key: keyof typeof errors) =>
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  // Inline "＋ 新增…" state, shared by the payer/currency/category/payment-method
  // selects below — only one can be open at a time.
  const [addingField, setAddingField] = useState<AddField>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCurrencyCode, setDraftCurrencyCode] = useState("");
  const [draftCurrencyRate, setDraftCurrencyRate] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [inlineRates, setInlineRates] = useState<Record<string, number> | null>(null);

  const numericAmount = parseFloat(amount) || 0;
  const selectedCurrency = trip.currencies.find((c) => c.id === currencyId);
  const rateIsLocked = !!selectedCurrency?.is_base; // base currency's rate is always 1.0, same rule as CurrenciesSection.tsx
  const selectedPaymentMethod = trip.payment_methods.find((pm) => pm.id === paymentMethodId);
  const isCreditCard = selectedPaymentMethod?.name === CREDIT_CARD_PAYMENT_METHOD_NAME;
  const numericForeignFee = isCreditCard ? parseFloat(foreignFee) || 0 : 0;
  // The actual total this expense/income represents once the foreign
  // transaction fee is folded in — this (not the raw `amount` typed into the
  // 金額 field) is what split amounts must sum to and what the split-preview
  // endpoint is asked to divide, mirroring the backend's
  // effective_amount = amount + (foreign_fee or 0) (see routers/expenses.py).
  const effectiveAmount = numericAmount + numericForeignFee;
  const payerLabel = expenseType === "income" ? "收款人" : "付款人";
  const allMembersSelected = trip.members.length > 0 && trip.members.every((m) => selectedMemberIds.includes(m.id));
  const toggleSelectAllMembers = () => {
    setSelectedMemberIds(allMembersSelected ? [] : trip.members.map((m) => m.id));
  };

  // Guards against an in-flight splitPreview response from a *previous*
  // amount/member/mode selection resolving after a newer one and
  // overwriting it with stale numbers (classic out-of-order async race).
  const requestSeqRef = useRef(0);

  // Reset form whenever a different expense (or create-mode) is opened.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional form reset on (re)open
    setExpenseType(expense?.type ?? "expense");
    setDate(expense?.date ?? todayIso());
    setCategoryId(expense?.category_id ?? trip.categories[0]?.id ?? null);
    setName(expense?.name ?? "");
    setAmount(expense ? String(expense.amount) : "");
    setForeignFee(expense?.foreign_fee != null ? String(expense.foreign_fee) : "");
    {
      const resetCurrencyId = expense?.currency_id ?? baseCurrency?.id ?? 0;
      setCurrencyId(resetCurrencyId);
      const resetCurrency = trip.currencies.find((c) => c.id === resetCurrencyId);
      setRateInput(expense ? String(expense.rate_snapshot) : defaultRateForCurrency(resetCurrency));
    }
    setPayerId(expense?.payer_id ?? trip.members[0]?.id ?? 0);
    setPaymentMethodId(expense?.payment_method_id ?? trip.payment_methods[0]?.id ?? null);
    setNote(expense?.note ?? "");
    setImageUrl(expense?.image_url ?? null);
    setImageUploading(false);
    setImageError(null);
    setNeedsSplit(canSplit ? expense?.needs_split ?? false : false);
    setSelectedMemberIds(expense?.shares.map((s) => s.member_id) ?? trip.members.map((m) => m.id));
    setShareAmounts(Object.fromEntries((expense?.shares ?? []).map((s) => [s.member_id, s.amount])));
    setShareSettled(Object.fromEntries((expense?.shares ?? []).map((s) => [s.member_id, s.is_settled])));
    // "custom" protects real (possibly non-equal) loaded amounts from being
    // clobbered by an auto-recompute effect (both recompute effects below
    // are gated on splitMode, so "custom" means neither ever fires until the
    // user explicitly switches tabs) — "equal" otherwise, see
    // initialSplitMode's own comment above.
    setSplitMode((expense?.shares.length ?? 0) > 0 ? "custom" : "equal");
    setShareCounts(Object.fromEntries(trip.members.map((m) => [m.id, 1])));
    setErrors({});
    setAddingField(null);
    setDraftName("");
    setDraftCurrencyCode("");
    setDraftCurrencyRate("");
    setAddError(null);
    requestSeqRef.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id]);

  // Derived, not raw `needsSplit`, is what actually drives validation/payload
  // /rendering below — this is the safety net for the rare case trip.members
  // shrinks to 1 while this form is already open with the toggle still on
  // (e.g. the last other member got deleted from Settings in another tab):
  // the toggle becomes hidden (see canSplit in the JSX below) but doesn't
  // need an effect to force needsSplit itself back to false, since nothing
  // downstream ever reads raw needsSplit without going through this.
  const effectiveNeedsSplit = canSplit && needsSplit;

  // Bulk rate lookup for the inline "＋ 新增幣別" sub-form — same
  // trip-independent endpoint CurrenciesSection/CreateTripDialog use, fetched
  // only while that sub-form is actually open.
  useEffect(() => {
    if (addingField !== "currency") return;
    let cancelled = false;
    getCurrencyRates(baseCurrency?.code ?? "TWD")
      .then((res) => {
        if (!cancelled) setInlineRates(res.rates);
      })
      .catch(() => {
        if (!cancelled) setInlineRates(null);
      });
    return () => {
      cancelled = true;
    };
  }, [addingField, baseCurrency?.code]);

  const recomputeEqualSplit = async (memberIds: number[], amt: number) => {
    if (memberIds.length === 0 || amt <= 0) {
      setShareAmounts({});
      return;
    }
    const seq = ++requestSeqRef.current;
    try {
      const preview = await splitPreview(tripId, amt, memberIds);
      // Drop this response if a newer request (reset, or a further edit)
      // has started since — otherwise a slow, now-stale response can
      // overwrite what a faster, more recent one already set.
      if (seq !== requestSeqRef.current) return;
      const next: Record<number, number> = {};
      for (const [mid, val] of Object.entries(preview)) next[Number(mid)] = val;
      setShareAmounts(next);
    } catch {
      // best-effort preview; backend still validates on submit
    }
  };

  // Same idea as recomputeEqualSplit but for "依份數分攤" — passes each
  // selected member's share count (default 1 for anyone not yet in
  // shareCounts, e.g. a member just toggled on) to the extended
  // split-preview endpoint, which runs weighted_split server-side.
  const recomputeWeightedSplit = async (memberIds: number[], amt: number, counts: Record<number, number>) => {
    if (memberIds.length === 0 || amt <= 0) {
      setShareAmounts({});
      return;
    }
    const seq = ++requestSeqRef.current;
    try {
      const sharesPayload = Object.fromEntries(memberIds.map((mid) => [mid, Math.max(1, counts[mid] ?? 1)]));
      const preview = await splitPreview(tripId, amt, memberIds, sharesPayload);
      if (seq !== requestSeqRef.current) return;
      const next: Record<number, number> = {};
      for (const [mid, val] of Object.entries(preview)) next[Number(mid)] = val;
      setShareAmounts(next);
    } catch {
      // best-effort preview; backend still validates on submit
    }
  };

  // Auto-recompute whenever participants/amount (and, in "shares" mode,
  // share counts) change — but only in "equal"/"shares" mode. "custom" never
  // auto-recomputes: the user's typed amounts are the source of truth there.
  // Switching *into* "equal" or "shares" (via the tabs below) also triggers
  // this immediately, since splitMode is itself a dependency — that's the
  // desired "recompute right away when the user picks this tab" behavior.
  useEffect(() => {
    if (!effectiveNeedsSplit || splitMode !== "equal") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dep-change split preview (async, sets state once the response resolves), same pattern as the currency-rates-fetch effect above
    recomputeEqualSplit(selectedMemberIds, effectiveAmount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveNeedsSplit, splitMode, selectedMemberIds.join(","), effectiveAmount]);

  useEffect(() => {
    if (!effectiveNeedsSplit || splitMode !== "shares") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-dep-change split preview (async, sets state once the response resolves), same pattern as the currency-rates-fetch effect above
    recomputeWeightedSplit(selectedMemberIds, effectiveAmount, shareCounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveNeedsSplit, splitMode, selectedMemberIds.join(","), effectiveAmount, JSON.stringify(shareCounts)]);

  const toggleMember = (memberId: number) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const shareSum = useMemo(
    () => selectedMemberIds.reduce((sum, mid) => sum + (shareAmounts[mid] ?? 0), 0),
    [selectedMemberIds, shareAmounts]
  );
  // Compared against effectiveAmount (amount + foreign fee), not the raw
  // amount field — the fee is part of what actually gets split (see
  // effectiveAmount's own comment above / backend routers/expenses.py).
  const shareSumMismatch = effectiveNeedsSplit && Math.abs(shareSum - effectiveAmount) > 0.01;

  // ---- Inline "＋ 新增…" flows (payer / currency / category / payment method) ----
  // Each creates the item via the existing create* API, selects it into this
  // form immediately (so the user never has to re-pick it), then asks the
  // parent to reload `trip` via onTripChanged so the option persists once
  // this dialog closes/reopens.
  const currencyOptionsForAdd = CURATED_CURRENCIES.filter(
    (c) => !trip.currencies.some((tc) => tc.code === c.code)
  );

  const startAdd = (field: AddField) => {
    setAddingField(field);
    setDraftName("");
    setDraftCurrencyCode("");
    setDraftCurrencyRate("");
    setAddError(null);
  };
  const cancelAdd = () => {
    setAddingField(null);
    setDraftName("");
    setDraftCurrencyCode("");
    setDraftCurrencyRate("");
    setAddError(null);
  };
  const onSelectDraftCurrencyCode = (code: string) => {
    setDraftCurrencyCode(code);
    if (code && inlineRates && inlineRates[code] !== undefined) {
      setDraftCurrencyRate(String(inlineRates[code]));
    } else {
      setDraftCurrencyRate("");
    }
  };

  const confirmAddMember = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) return setAddError("請輸入成員姓名");
    setAddBusy(true);
    setAddError(null);
    try {
      const created = await createMember(tripId, trimmed);
      showToast(`已新增成員「${created.name}」`);
      setPayerId(created.id);
      clearError("payerId");
      onTripChanged?.();
      cancelAdd();
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "新增成員失敗");
    } finally {
      setAddBusy(false);
    }
  };

  const confirmAddCategory = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) return setAddError("請輸入分類名稱");
    setAddBusy(true);
    setAddError(null);
    try {
      const created = await createCategory(tripId, { name: trimmed });
      showToast(`已新增分類「${created.name}」`);
      setCategoryId(created.id);
      onTripChanged?.();
      cancelAdd();
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "新增分類失敗");
    } finally {
      setAddBusy(false);
    }
  };

  const confirmAddPaymentMethod = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) return setAddError("請輸入付款方式名稱");
    setAddBusy(true);
    setAddError(null);
    try {
      const created = await createPaymentMethod(tripId, trimmed);
      showToast(`已新增付款方式「${created.name}」`);
      setPaymentMethodId(created.id);
      onTripChanged?.();
      cancelAdd();
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "新增付款方式失敗");
    } finally {
      setAddBusy(false);
    }
  };

  const confirmAddCurrency = async () => {
    if (!draftCurrencyCode) return setAddError("請選擇幣別");
    const rateNum = parseFloat(draftCurrencyRate);
    if (!rateNum || rateNum <= 0) return setAddError("請輸入有效的匯率");
    setAddBusy(true);
    setAddError(null);
    try {
      const option = CURATED_CURRENCIES.find((c) => c.code === draftCurrencyCode);
      const created = await createCurrency(tripId, {
        code: draftCurrencyCode,
        name: option?.name ?? draftCurrencyCode,
        rate_to_base: rateNum,
      });
      showToast(`已新增幣別「${created.code}」`);
      setCurrencyId(created.id);
      setRateInput(String(rateNum));
      clearError("currencyId");
      clearError("rate");
      onTripChanged?.();
      cancelAdd();
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "新增幣別失敗");
    } finally {
      setAddBusy(false);
    }
  };

  const handleImageSelected = async (file: File | undefined) => {
    if (!file) return;
    setImageError(null);
    setImageUploading(true);
    try {
      const { url } = await uploadExpenseImage(file);
      setImageUrl(url);
    } catch (e) {
      setImageError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "上傳圖片失敗");
    } finally {
      setImageUploading(false);
      // Allow re-selecting the exact same file later (e.g. after removing it).
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    // Item name is optional — a blank name is backfilled server-side to a
    // type-appropriate default ("支出"/"收入"), so there's no client-side
    // required-field check here anymore.
    if (numericAmount <= 0) newErrors.amount = "請輸入有效金額";
    if (!currencyId) newErrors.currencyId = "請選擇幣別";
    const numericRate = parseFloat(rateInput);
    if (!numericRate || numericRate <= 0) newErrors.rate = "請輸入有效的匯率";
    if (isCreditCard && foreignFee.trim() !== "" && (isNaN(parseFloat(foreignFee)) || parseFloat(foreignFee) < 0)) {
      newErrors.foreignFee = "手續費需為 0 以上的數字";
    }
    if (!payerId) newErrors.payerId = `請選擇${payerLabel}`;
    if (effectiveNeedsSplit) {
      if (selectedMemberIds.length === 0) newErrors.shares = "請至少勾選一位分攤成員";
      else if (shareSumMismatch) newErrors.shares = `分攤金額合計 (${shareSum.toFixed(2)}) 與支出金額（含手續費）不符`;
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const shares: ExpenseShareInput[] = effectiveNeedsSplit
      ? selectedMemberIds.map((mid) => ({
          member_id: mid,
          amount: shareAmounts[mid] ?? 0,
          is_settled: shareSettled[mid] ?? false,
        }))
      : [];

    const payload = {
      date,
      category_id: categoryId,
      name: name.trim(),
      amount: numericAmount,
      foreign_fee: isCreditCard && foreignFee.trim() !== "" ? numericForeignFee : null,
      currency_id: currencyId,
      // Always sent explicitly (not just when the user actually edits it) —
      // the field always shows a concrete number (defaulted from the
      // currency's rate_to_base, or the expense's previous rate_snapshot
      // when editing), and the backend treats "rate_override present" as
      // "pin rate_snapshot to this value" vs "absent -> recompute from the
      // currency's current rate_to_base" (see ExpenseCreate.rate_override /
      // routers/expenses.py). Sending it unconditionally means what's shown
      // on screen is always exactly what gets saved.
      rate_override: numericRate,
      payer_id: payerId,
      payment_method_id: paymentMethodId,
      note: note.trim() || null,
      needs_split: effectiveNeedsSplit,
      shares,
      type: expenseType,
      image_url: imageUrl,
    };

    setSubmitting(true);
    try {
      const saved = isEdit ? await updateExpense(tripId, expense!.id, payload) : await createExpense(tripId, payload);
      showToast(isEdit ? "支出已更新" : "支出已新增");
      onSaved(saved);
    } catch (e) {
      // Operation-result failure (network/server error on the actual save
      // call) — toast, not inline, per the inline/toast split documented in
      // ToastContext.tsx. The validation checks above this try block stay
      // inline via setErrors since those need the user to stay on the form
      // and fix an input.
      showToast(e instanceof Error ? e.message : "儲存支出失敗", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";
  const labelCls = "block text-[11.5px] font-medium text-slate-500 mb-1";

  const dialogTitle = isEdit
    ? expenseType === "income"
      ? "編輯收入"
      : "編輯支出"
    : expenseType === "income"
      ? "新增收入"
      : "新增支出";

  return (
    <Dialog open={open} onClose={onClose} title={dialogTitle} subtitle={trip.name}>
      {/* 支出／收入 tab — defaults to "支出"; drives payload.type, the
          付款人/收款人 label, and the blank-name fallback. Editing an
          existing record shows its real type and can be switched freely
          (see expenseType's own comment above). */}
      <div className="inline-flex bg-slate-100 rounded-lg p-1 gap-1 mb-4">
        {(
          [
            ["expense", "支出"],
            ["income", "收入"],
          ] as [ExpenseType, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setExpenseType(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${
              expenseType === t ? "bg-white shadow-sm text-teal-700" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="lg:grid lg:grid-cols-2 lg:gap-6">
        {/* Left / top: basic fields */}
        <div className="space-y-3">
          <div>
            <label className={labelCls}>金額</label>
            <input
              type="text"
              inputMode="decimal"
              className={`${inputCls} text-lg font-semibold tabular-nums`}
              value={amount}
              onChange={(e) => {
                setAmount(filterDecimalInput(e.target.value));
                clearError("amount");
              }}
              placeholder="0"
              autoFocus
            />
            {errors.amount && <p className="text-xs text-rose-600 mt-1">{errors.amount}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>日期</label>
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>幣別</label>
              {addingField === "currency" ? (
                <InlineAddRow
                  placeholder=""
                  value=""
                  onChange={() => {}}
                  onConfirm={confirmAddCurrency}
                  onCancel={cancelAdd}
                  busy={addBusy}
                  error={addError}
                  extra={
                    <div className="flex gap-1.5">
                      <Select
                        className="flex-1"
                        value={draftCurrencyCode}
                        onChange={onSelectDraftCurrencyCode}
                        placeholder="選擇幣別…"
                        options={currencyOptionsForAdd.map((c) => ({ value: c.code, label: formatCurrencyOption(c) }))}
                      />
                      <input
                        className="w-20 border border-slate-300 rounded-lg px-2 py-2 text-xs"
                        placeholder="匯率"
                        type="text"
                        inputMode="decimal"
                        value={draftCurrencyRate}
                        onChange={(e) => setDraftCurrencyRate(filterDecimalInput(e.target.value))}
                      />
                    </div>
                  }
                />
              ) : (
                <>
                  <Select
                    value={String(currencyId)}
                    onChange={(v) => {
                      if (v === "__add__") return startAdd("currency");
                      const nextId = Number(v);
                      setCurrencyId(nextId);
                      clearError("currencyId");
                      // Reset the rate to the newly-picked currency's own
                      // rate_to_base (or 1.0 if it's the base currency) — any
                      // manual override typed for the *previous* currency
                      // isn't meaningful for a different currency.
                      const nextCurrency = trip.currencies.find((c) => c.id === nextId);
                      setRateInput(defaultRateForCurrency(nextCurrency));
                      clearError("rate");
                    }}
                    options={[
                      ...trip.currencies.map((c) => ({ value: String(c.id), label: `${c.code} ${c.name}` })),
                      ...(canQuickAdd ? [{ value: "__add__", label: "＋ 新增幣別…" }] : []),
                    ]}
                  />
                  {errors.currencyId && <p className="text-xs text-rose-600 mt-1">{errors.currencyId}</p>}
                </>
              )}
            </div>
          </div>
          <div>
            <label className={labelCls}>
              這筆{expenseType === "income" ? "收入" : "支出"}使用的匯率
              {/* The "(1 X = ? Y)" formula only makes sense when a real
                  conversion is happening — when the field is locked (selected
                  currency == base currency, so X and Y are the same code) it
                  used to still render "(1 JPY = ? JPY)" right above copy
                  saying the rate is fixed at 1, which read as contradictory.
                  See uiux-audit-2026-08-12.md §2.2. */}
              {!rateIsLocked && selectedCurrency && ` (1 ${selectedCurrency.code} = ? ${trip.base_currency_code})`}
            </label>
            {rateIsLocked ? (
              <p className="text-xs text-slate-400 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 tabular-nums">
                1.00000（{trip.base_currency_code} 為基準幣，匯率固定為 1，不可更改）
              </p>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="decimal"
                  className={`${inputCls} tabular-nums`}
                  value={rateInput}
                  onChange={(e) => {
                    setRateInput(filterDecimalInput(e.target.value));
                    clearError("rate");
                  }}
                />
                {errors.rate && <p className="text-xs text-rose-600 mt-1">{errors.rate}</p>}
              </>
            )}
          </div>
          <div>
            <label className={labelCls}>項目名稱（選填）</label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={expenseType === "income" ? `例如：飯店退款、代購收款` : `例如：晚餐、計程車、藥妝店`}
            />
          </div>
          <div>
            <label className={labelCls}>分類</label>
            {addingField === "category" ? (
              <InlineAddRow
                placeholder="新分類名稱"
                value={draftName}
                onChange={setDraftName}
                onConfirm={confirmAddCategory}
                onCancel={cancelAdd}
                busy={addBusy}
                error={addError}
              />
            ) : (
              // Dropdown alone already shows the selected category's name —
              // the extra CategoryChip that used to sit next to it just
              // duplicated that (same name/color) with no added information,
              // per user feedback it was redundant.
              <Select
                value={categoryId != null ? String(categoryId) : ""}
                onChange={(v) => {
                  if (v === "__add__") return startAdd("category");
                  setCategoryId(v ? Number(v) : null);
                }}
                options={[
                  { value: "", label: "未分類" },
                  ...trip.categories.map((c) => ({ value: String(c.id), label: c.name })),
                  ...(canQuickAdd ? [{ value: "__add__", label: "＋ 新增分類…" }] : []),
                ]}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{payerLabel}</label>
              {addingField === "payer" ? (
                <InlineAddRow
                  placeholder={`新${payerLabel}姓名`}
                  value={draftName}
                  onChange={setDraftName}
                  onConfirm={confirmAddMember}
                  onCancel={cancelAdd}
                  busy={addBusy}
                  error={addError}
                />
              ) : (
                <>
                  <Select
                    value={String(payerId)}
                    onChange={(v) => {
                      if (v === "__add__") return startAdd("payer");
                      setPayerId(Number(v));
                      clearError("payerId");
                    }}
                    options={[
                      ...trip.members.map((m) => ({ value: String(m.id), label: m.name })),
                      ...(canQuickAdd ? [{ value: "__add__", label: `＋ 新增${payerLabel}…` }] : []),
                    ]}
                  />
                  {errors.payerId && <p className="text-xs text-rose-600 mt-1">{errors.payerId}</p>}
                </>
              )}
            </div>
            <div>
              <label className={labelCls}>付款方式</label>
              {addingField === "paymentMethod" ? (
                <InlineAddRow
                  placeholder="新付款方式名稱"
                  value={draftName}
                  onChange={setDraftName}
                  onConfirm={confirmAddPaymentMethod}
                  onCancel={cancelAdd}
                  busy={addBusy}
                  error={addError}
                />
              ) : (
                <Select
                  value={paymentMethodId != null ? String(paymentMethodId) : ""}
                  onChange={(v) => {
                    if (v === "__add__") return startAdd("paymentMethod");
                    const nextId = v ? Number(v) : null;
                    setPaymentMethodId(nextId);
                    // Clear any typed foreign fee when switching away from
                    // 信用卡 so a stale fee never silently survives onto a
                    // cash/other-method expense (see isCreditCard above).
                    const nextMethod = trip.payment_methods.find((pm) => pm.id === nextId);
                    if (nextMethod?.name !== CREDIT_CARD_PAYMENT_METHOD_NAME) {
                      setForeignFee("");
                      clearError("foreignFee");
                    }
                  }}
                  options={[
                    { value: "", label: "未指定" },
                    ...trip.payment_methods.map((pm) => ({ value: String(pm.id), label: pm.name })),
                    ...(canQuickAdd ? [{ value: "__add__", label: "＋ 新增付款方式…" }] : []),
                  ]}
                />
              )}
              {isCreditCard && (
                <div className="mt-2">
                  <label className={labelCls}>海外手續費（選填）</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={inputCls}
                    value={foreignFee}
                    onChange={(e) => {
                      setForeignFee(filterDecimalInput(e.target.value));
                      clearError("foreignFee");
                    }}
                    placeholder="0"
                  />
                  {errors.foreignFee && <p className="text-xs text-rose-600 mt-1">{errors.foreignFee}</p>}
                  <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                    原金額 {numericAmount.toFixed(2)} + 手續費 {numericForeignFee.toFixed(2)} = 總金額{" "}
                    {effectiveAmount.toFixed(2)} {selectedCurrency?.code ?? ""}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className={labelCls}>備註</label>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="選填" />
          </div>
          <div>
            <label className={labelCls}>收據 / 圖片（選填）</label>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handleImageSelected(e.target.files?.[0])}
            />
            {imageUrl ? (
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- backend-hosted upload, not a Next-optimizable static asset */}
                <img
                  src={`${API_BASE}${imageUrl}`}
                  alt="收據縮圖"
                  className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0"
                />
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="text-xs text-teal-700 hover:underline text-left"
                  >
                    重新選擇
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="text-xs text-rose-600 hover:underline text-left"
                  >
                    移除圖片
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={imageUploading}
                className="w-full border border-dashed border-slate-300 rounded-lg py-3 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-60"
              >
                {imageUploading ? "上傳中…" : "＋ 選擇圖片（例如收據照片）"}
              </button>
            )}
            {imageError && <p className="text-xs text-rose-600 mt-1">{imageError}</p>}
          </div>
        </div>

        {/* Right / bottom: split settings */}
        <div className="mt-4 lg:mt-0">
          {canSplit ? (
            <div className="flex items-center justify-between py-2.5 border-t border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-800">這筆需要分帳</span>
              <button
                type="button"
                role="switch"
                aria-checked={needsSplit}
                onClick={() => setNeedsSplit((v) => !v)}
                className={`w-[38px] h-[22px] rounded-full relative shrink-0 transition-colors ${
                  needsSplit ? "bg-teal-600" : "bg-slate-300"
                }`}
              >
                {/*
                  Knob positioning bug fix: this span used to rely on the
                  browser's default "static position" for an absolutely
                  positioned box with no explicit `left` (only `top-0.5`) to
                  place it at the pill's left edge. In practice that resolved
                  to ~19px into the 38px-wide button — not 0 — so combined
                  with the "on" state's translate-x-[18px] the knob ended up
                  ~37px past the button's left edge, almost entirely outside
                  its 38px width (only a ~1px sliver still overlapping the
                  pill) and invisible against the white dialog background
                  behind it (white knob on white page). Pinning `left-0.5`
                  explicitly removes that ambiguity; translate-x-4 (16px, a
                  standard non-arbitrary Tailwind class) then lands the knob
                  symmetrically 2px from the right edge when on, matching the
                  2px top/bottom/left inset when off.
                */}
                <span
                  className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-transform ${
                    needsSplit ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between py-2.5 border-t border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-400">這筆需要分帳</span>
              <span className="text-[11px] text-slate-400">僅 1 位成員，無需分帳</span>
            </div>
          )}

          {effectiveNeedsSplit && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-600">分帳設定</p>
                <div className="inline-flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                  {(
                    [
                      ["equal", "平均分攤"],
                      ["custom", "自訂金額"],
                      ["shares", "依份數分攤"],
                    ] as [SplitMode, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSplitMode(mode)}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap ${
                        splitMode === mode ? "bg-white shadow-sm text-teal-700" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allMembersSelected}
                    onChange={toggleSelectAllMembers}
                    className="w-3.5 h-3.5 accent-teal-600 shrink-0"
                  />
                  全選
                </label>
                <span className="text-[11px] text-slate-400">
                  {selectedMemberIds.length}/{trip.members.length} 人
                </span>
              </div>
              <div className="space-y-1.5">
                {trip.members.map((m) => {
                  const checked = selectedMemberIds.includes(m.id);
                  return (
                    <div key={m.id} className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(m.id)}
                        className="w-4 h-4 accent-teal-600 shrink-0"
                      />
                      <Avatar name={m.name} color={m.color} avatarUrl={m.avatar_url} size="sm" />
                      <span className={`text-[12.5px] flex-1 ${checked ? "text-slate-700" : "text-slate-400"}`}>
                        {m.name}
                        {!checked && "（未參與）"}
                      </span>
                      <label className="flex items-center gap-1 text-[10.5px] text-slate-400 shrink-0">
                        <input
                          type="checkbox"
                          disabled={!checked}
                          checked={shareSettled[m.id] ?? false}
                          onChange={(e) => setShareSettled((prev) => ({ ...prev, [m.id]: e.target.checked }))}
                          className="w-3 h-3 accent-teal-600"
                        />
                        已結清
                      </label>
                      {splitMode === "shares" ? (
                        <>
                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min={1}
                              step={1}
                              disabled={!checked}
                              value={checked ? shareCounts[m.id] ?? 1 : ""}
                              onChange={(e) => {
                                const parsed = parseInt(e.target.value, 10);
                                const v = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
                                setShareCounts((prev) => ({ ...prev, [m.id]: v }));
                              }}
                              className="w-11 border border-slate-300 rounded-md px-1 py-1 text-xs text-center tabular-nums disabled:bg-slate-50 disabled:text-slate-300"
                            />
                            <span className="text-[10px] text-slate-400">份</span>
                          </div>
                          <span className="w-[70px] text-right text-xs tabular-nums text-slate-500 shrink-0">
                            {checked ? (shareAmounts[m.id] ?? 0).toFixed(2) : "-"}
                          </span>
                        </>
                      ) : (
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!checked || splitMode === "equal"}
                          value={checked ? shareAmounts[m.id] ?? 0 : ""}
                          onChange={(e) => {
                            const filtered = filterDecimalInput(e.target.value);
                            setShareAmounts((prev) => ({ ...prev, [m.id]: parseFloat(filtered) || 0 }));
                          }}
                          className="w-[86px] border border-slate-300 rounded-md px-1.5 py-1 text-xs text-right tabular-nums disabled:bg-slate-50 disabled:text-slate-300"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className={`text-[11px] mt-2 ${errors.shares || shareSumMismatch ? "text-rose-600" : "text-slate-400"}`}>
                {errors.shares ??
                  `分攤合計 ${shareSum.toFixed(2)} / 支出金額${isCreditCard ? "（含手續費）" : ""} ${effectiveAmount.toFixed(2)}${
                    shareSumMismatch ? "（合計需等於支出金額）" : ""
                  }`}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" type="button" onClick={onClose}>
          取消
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={submitting || imageUploading} className="w-full lg:w-auto">
          {submitting ? "儲存中…" : "儲存"}
        </Button>
      </div>
    </Dialog>
  );
}
