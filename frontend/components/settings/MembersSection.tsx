"use client";

import { useState } from "react";
import Card from "@/components/Card";
import Avatar from "@/components/Avatar";
import ConfirmButton from "@/components/ConfirmButton";
import { createMember, deleteMember } from "@/lib/api";
import type { TripDetail } from "@/lib/types";

export default function MembersSection({
  trip,
  onChanged,
  bare = false,
}: {
  trip: TripDetail;
  onChanged: () => void;
  bare?: boolean;
}) {
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createMember(trip.id, newName.trim());
      setNewName("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新增成員失敗");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteMember(id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除成員失敗（可能已有支出紀錄使用此成員）");
    }
  };

  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper id="section-members">
      {!bare && <p className="text-sm md:text-base font-semibold text-slate-900 mb-3">成員</p>}
      <div>
        {trip.members.map((m) => (
          <div key={m.id} className="flex items-center gap-2.5 py-2 border-b border-slate-100 last:border-b-0">
            <Avatar name={m.name} color={m.color} size="sm" />
            <span className="text-[13.5px] text-slate-800 flex-1">{m.name}</span>
            <ConfirmButton
              message={`確定要移除成員「${m.name}」嗎？若此成員已被支出使用，刪除將會失敗。`}
              onConfirm={() => remove(m.id)}
              className="text-slate-400 hover:text-rose-600 text-sm"
            >
              ✕
            </ConfirmButton>
          </div>
        ))}
        {trip.members.length === 0 && <p className="text-sm text-slate-400 py-2">尚未新增成員</p>}
      </div>
      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      <div className="flex gap-2 mt-2.5">
        <input
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
          placeholder="輸入成員姓名…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          onClick={add}
          disabled={busy}
          className="border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap"
        >
          ＋ 新增成員
        </button>
      </div>
    </Wrapper>
  );
}
