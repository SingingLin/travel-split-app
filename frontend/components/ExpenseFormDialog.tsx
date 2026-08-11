"use client";

import { useEffect, useMemo, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import Avatar from "./Avatar";
import { CategoryChip } from "./Chip";
import { createExpense, splitPreview, updateExpense } from "@/lib/api";
import type { Expense, ExpenseShareInput, TripDetail } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpenseFormDialog({
  open,
  onClose,
  tripId,
  trip,
  expense,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  tripId: number;
  trip: TripDetail;
  expense?: Expense | null;
  onSaved: (expense: Expense) => void;
}) {
  const isEdit = !!expense;
  const baseCurrency = trip.currencies.find((c) => c.is_base) ?? trip.currencies[0];

  const [date, setDate] = useState(expense?.date ?? todayIso());
  const [categoryId, setCategoryId] = useState<number | null>(
    expense?.category_id ?? trip.categories[0]?.id ?? null
  );
  const [name, setName] = useState(expense?.name ?? "");
  const [amount, setAmount] = useState<string>(expense ? String(expense.amount) : "");
  const [currencyId, setCurrencyId] = useState<number>(expense?.currency_id ?? baseCurrency?.id ?? 0);
  const [payerId, setPayerId] = useState<number>(expense?.payer_id ?? trip.members[0]?.id ?? 0);
  const [paymentMethodId, setPaymentMethodId] = useState<number | null>(
    expense?.payment_method_id ?? trip.payment_methods[0]?.id ?? null
  );
  const [note, setNote] = useState(expense?.note ?? "");
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numericAmount = parseFloat(amount) || 0;

  // Reset form whenever a different expense (or create-mode) is opened.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional form reset on (re)open
    setDate(expense?.date ?? todayIso());
    setCategoryId(expense?.category_id ?? trip.categories[0]?.id ?? null);
    setName(expense?.name ?? "");
    setAmount(expense ? String(expense.amount) : "");
    setCurrencyId(expense?.currency_id ?? baseCurrency?.id ?? 0);
    setPayerId(expense?.payer_id ?? trip.members[0]?.id ?? 0);
    setPaymentMethodId(expense?.payment_method_id ?? trip.payment_methods[0]?.id ?? null);
    setNote(expense?.note ?? "");
    setNeedsSplit(expense?.needs_split ?? false);
    setSelectedMemberIds(expense?.shares.map((s) => s.member_id) ?? trip.members.map((m) => m.id));
    setShareAmounts(Object.fromEntries((expense?.shares ?? []).map((s) => [s.member_id, s.amount])));
    setShareSettled(Object.fromEntries((expense?.shares ?? []).map((s) => [s.member_id, s.is_settled])));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id]);

  const recomputeEqualSplit = async (memberIds: number[], amt: number) => {
    if (memberIds.length === 0 || amt <= 0) {
      setShareAmounts({});
      return;
    }
    try {
      const preview = await splitPreview(tripId, amt, memberIds);
      const next: Record<number, number> = {};
      for (const [mid, val] of Object.entries(preview)) next[Number(mid)] = val;
      setShareAmounts(next);
    } catch {
      // best-effort preview; backend still validates on submit
    }
  };

  // Auto-recompute equal split when participants or the total amount changes.
  useEffect(() => {
    if (!needsSplit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async preview fetch, not a sync setState
    recomputeEqualSplit(selectedMemberIds, numericAmount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSplit, selectedMemberIds.join(","), numericAmount]);

  const toggleMember = (memberId: number) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const shareSum = useMemo(
    () => selectedMemberIds.reduce((sum, mid) => sum + (shareAmounts[mid] ?? 0), 0),
    [selectedMemberIds, shareAmounts]
  );
  const shareSumMismatch = needsSplit && Math.abs(shareSum - numericAmount) > 0.01;

  const selectedCategory = trip.categories.find((c) => c.id === categoryId);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) return setError("請輸入項目名稱");
    if (numericAmount <= 0) return setError("請輸入有效金額");
    if (!currencyId) return setError("請選擇幣別");
    if (!payerId) return setError("請選擇付款人");
    if (needsSplit) {
      if (selectedMemberIds.length === 0) return setError("請至少勾選一位分攤成員");
      if (shareSumMismatch) return setError(`分攤金額合計 (${shareSum.toFixed(2)}) 與支出金額不符`);
    }

    const shares: ExpenseShareInput[] = needsSplit
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
      currency_id: currencyId,
      payer_id: payerId,
      payment_method_id: paymentMethodId,
      note: note.trim() || null,
      needs_split: needsSplit,
      shares,
    };

    setSubmitting(true);
    try {
      const saved = isEdit ? await updateExpense(tripId, expense!.id, payload) : await createExpense(tripId, payload);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存支出失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";
  const labelCls = "block text-[11.5px] font-medium text-slate-500 mb-1";

  return (
    <Dialog open={open} onClose={onClose} title={isEdit ? "編輯支出" : "新增支出"} subtitle={trip.name}>
      <div className="lg:grid lg:grid-cols-2 lg:gap-6">
        {/* Left / top: basic fields */}
        <div className="space-y-3">
          <div>
            <label className={labelCls}>金額</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className={`${inputCls} text-lg font-semibold tabular-nums`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>日期</label>
              <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>幣別</label>
              <select
                className={inputCls}
                value={currencyId}
                onChange={(e) => setCurrencyId(Number(e.target.value))}
              >
                {trip.currencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>項目名稱</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：海鮮晚餐" />
          </div>
          <div>
            <label className={labelCls}>分類</label>
            <div className="flex items-center gap-2">
              <select
                className={inputCls}
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">未分類</option>
                {trip.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {selectedCategory && <CategoryChip name={selectedCategory.name} color={selectedCategory.color} />}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>付款人</label>
              <select className={inputCls} value={payerId} onChange={(e) => setPayerId(Number(e.target.value))}>
                {trip.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>付款方式</label>
              <select
                className={inputCls}
                value={paymentMethodId ?? ""}
                onChange={(e) => setPaymentMethodId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">未指定</option>
                {trip.payment_methods.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>備註</label>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="選填" />
          </div>
        </div>

        {/* Right / bottom: split settings */}
        <div className="mt-4 lg:mt-0">
          <div className="flex items-center justify-between py-2.5 border-t border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-800">這筆需要分帳</span>
            <button
              type="button"
              role="switch"
              aria-checked={needsSplit}
              onClick={() => setNeedsSplit((v) => !v)}
              className={`w-[38px] h-[22px] rounded-full relative transition-colors ${
                needsSplit ? "bg-teal-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full transition-transform ${
                  needsSplit ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {needsSplit && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-600">分帳設定</p>
                <button
                  type="button"
                  onClick={() => recomputeEqualSplit(selectedMemberIds, numericAmount)}
                  className="text-[11px] font-semibold text-teal-600 border border-teal-100 bg-teal-50 rounded-full px-2.5 py-1"
                >
                  平均分攤
                </button>
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
                      <Avatar name={m.name} color={m.color} size="sm" />
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
                      <input
                        type="number"
                        step="0.01"
                        disabled={!checked}
                        value={checked ? shareAmounts[m.id] ?? 0 : ""}
                        onChange={(e) =>
                          setShareAmounts((prev) => ({ ...prev, [m.id]: parseFloat(e.target.value) || 0 }))
                        }
                        className="w-[86px] border border-slate-300 rounded-md px-1.5 py-1 text-xs text-right tabular-nums disabled:bg-slate-50 disabled:text-slate-300"
                      />
                    </div>
                  );
                })}
              </div>
              <p className={`text-[11px] mt-2 ${shareSumMismatch ? "text-rose-600" : "text-slate-400"}`}>
                分攤合計 {shareSum.toFixed(2)} / 支出金額 {numericAmount.toFixed(2)}
                {shareSumMismatch && "（合計需等於支出金額）"}
              </p>
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-rose-600 mt-4">{error}</p>}

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" type="button" onClick={onClose}>
          取消
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={submitting} className="w-full lg:w-auto">
          {submitting ? "儲存中…" : "儲存"}
        </Button>
      </div>
    </Dialog>
  );
}
