"use client";

import { useState } from "react";
import Card from "@/components/Card";
import { NeutralChip } from "@/components/Chip";
import { createPaymentMethod, deletePaymentMethod } from "@/lib/api";
import type { TripDetail } from "@/lib/types";

export default function PaymentMethodsSection({
  trip,
  onChanged,
  bare = false,
}: {
  trip: TripDetail;
  onChanged: () => void;
  bare?: boolean;
}) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return setAdding(false);
    try {
      await createPaymentMethod(trip.id, name.trim());
      setName("");
      setAdding(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增付款方式失敗");
    }
  };

  const remove = async (id: number) => {
    try {
      await deletePaymentMethod(id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除付款方式失敗");
    }
  };

  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper id="section-payment-methods">
      {!bare && <p className="text-sm md:text-base font-semibold text-slate-900 mb-3">付款方式</p>}
      <div className="flex flex-wrap gap-1.5">
        {trip.payment_methods.map((pm) => (
          <NeutralChip key={pm.id} label={pm.name} onRemove={() => remove(pm.id)} />
        ))}
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
            className="border border-dashed border-slate-300 rounded-full px-3 py-1 text-xs text-slate-400 font-medium"
          >
            ＋ 新增付款方式
          </button>
        )}
      </div>
      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
    </Wrapper>
  );
}
