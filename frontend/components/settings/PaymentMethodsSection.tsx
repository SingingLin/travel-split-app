"use client";

import { useRef, useState } from "react";
import Card from "@/components/Card";
import ConfirmButton from "@/components/ConfirmButton";
import { Plus } from "lucide-react";
import { NeutralChip } from "@/components/Chip";
import { createPaymentMethod, deletePaymentMethod, resetPaymentMethods, updatePaymentMethod } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import type { PaymentMethod, TripDetail } from "@/lib/types";

// Matches CREDIT_CARD_PAYMENT_METHOD_NAME in ExpenseFormDialog.tsx — that
// component's "海外手續費" field is only shown while the selected payment
// method's name is exactly this string (a short-term, name-based check, not
// a real "is this a credit card" flag — see its own comment). Deleting or
// renaming the built-in "信用卡" entry here silently makes that field
// disappear with no other signal, so this component warns about it via toast
// (see remove/commitEdit below) — see uiux-audit-2026-08-12.md §3.3.
const CREDIT_CARD_PAYMENT_METHOD_NAME = "信用卡";

export default function PaymentMethodsSection({
  trip,
  onChanged,
  bare = false,
}: {
  trip: TripDetail;
  onChanged: () => void;
  bare?: boolean;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Inline rename — click a chip's name to turn it into an input, Enter/blur
  // commits via updatePaymentMethod, Escape cancels without saving.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const savingIdRef = useRef<number | null>(null);
  const resettingRef = useRef(false);

  const add = async () => {
    if (!name.trim()) return setAdding(false);
    try {
      await createPaymentMethod(trip.id, name.trim());
      setName("");
      setAdding(false);
      onChanged();
      showToast(`已新增付款方式「${name.trim()}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "新增付款方式失敗", "error");
    }
  };

  const remove = async (id: number, name: string) => {
    // Payment method deletion is DB-safe (Expense.payment_method_id is
    // ondelete="SET NULL", see models.py) — it never fails because a
    // payment method is in use, it just clears that field on the affected
    // expenses. Say so explicitly instead of the old "可能會失敗" wording,
    // which was inaccurate.
    if (
      !window.confirm(`確定要刪除付款方式「${name}」嗎？已使用此付款方式的支出將自動變更為「未指定」。`)
    )
      return;
    try {
      await deletePaymentMethod(id);
      onChanged();
      showToast(`已刪除付款方式「${name}」`);
      if (name === CREDIT_CARD_PAYMENT_METHOD_NAME) {
        showToast("這會影響新增支出表單的「海外手續費」欄位，該欄位僅在付款方式為「信用卡」時顯示", "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "刪除付款方式失敗", "error");
    }
  };

  const startEdit = (pm: PaymentMethod) => {
    setEditingId(pm.id);
    setEditName(pm.name);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };
  const commitEdit = async (pm: PaymentMethod) => {
    if (savingIdRef.current === pm.id) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === pm.name) {
      cancelEdit();
      return;
    }
    savingIdRef.current = pm.id;
    try {
      await updatePaymentMethod(pm.id, trimmed);
      onChanged();
      showToast(`已更新付款方式「${trimmed}」`);
      if (pm.name === CREDIT_CARD_PAYMENT_METHOD_NAME) {
        showToast("這會影響新增支出表單的「海外手續費」欄位，該欄位僅在付款方式為「信用卡」時顯示", "error");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新付款方式失敗", "error");
    } finally {
      savingIdRef.current = null;
      cancelEdit();
    }
  };

  const resetToDefaults = async () => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    setResetting(true);
    try {
      await resetPaymentMethods(trip.id);
      onChanged();
      showToast("付款方式已重設為預設清單");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "重設付款方式失敗", "error");
    } finally {
      resettingRef.current = false;
      setResetting(false);
    }
  };

  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper id="section-payment-methods">
      {!bare && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm md:text-base font-semibold text-slate-900">付款方式</p>
          <ConfirmButton
            message="確定要重設付款方式嗎？將清空目前所有付款方式，並改回預設的 2 種付款方式（現金／信用卡）；已使用中的支出會自動變成「未指定」。"
            onConfirm={resetToDefaults}
            className="text-[11px] text-slate-400 hover:text-rose-600 font-medium"
          >
            {resetting ? "重設中…" : "重設為預設"}
          </ConfirmButton>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 items-center">
        {trip.payment_methods.map((pm) =>
          editingId === pm.id ? (
            <div
              key={pm.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-teal-400 bg-white px-2.5 py-1"
            >
              <input
                autoFocus
                className="w-20 text-xs outline-none"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => commitEdit(pm)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit(pm);
                  if (e.key === "Escape") cancelEdit();
                }}
              />
            </div>
          ) : (
            <NeutralChip
              key={pm.id}
              label={pm.name}
              onNameClick={() => startEdit(pm)}
              onRemove={() => remove(pm.id, pm.name)}
            />
          )
        )}
        {adding ? (
          <input
            autoFocus
            className="border border-dashed border-slate-300 rounded-full px-3 py-1 text-xs text-slate-600 outline-none"
            placeholder="付款方式名稱"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="border border-dashed border-slate-300 rounded-full px-3 py-1 text-xs text-slate-400 font-medium inline-flex items-center gap-1"
          >
            <Plus size={12} aria-hidden="true" /> 新增付款方式
          </button>
        )}
      </div>
      {bare && (
        <div className="mt-3">
          <ConfirmButton
            message="確定要重設付款方式嗎？將清空目前所有付款方式，並改回預設的 2 種付款方式（現金／信用卡）；已使用中的支出會自動變成「未指定」。"
            onConfirm={resetToDefaults}
            className="text-[11px] text-slate-400 hover:text-rose-600 font-medium"
          >
            {resetting ? "重設中…" : "重設為預設"}
          </ConfirmButton>
        </div>
      )}
    </Wrapper>
  );
}
