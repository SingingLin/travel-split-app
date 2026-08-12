"use client";

import { useRef, useState } from "react";
import Card from "@/components/Card";
import Avatar from "@/components/Avatar";
import ConfirmButton from "@/components/ConfirmButton";
import { Plus, X } from "lucide-react";
import { createMember, deleteMember, updateMember } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import type { Member, TripDetail } from "@/lib/types";

export default function MembersSection({
  trip,
  onChanged,
  bare = false,
}: {
  trip: TripDetail;
  onChanged: () => void;
  bare?: boolean;
}) {
  const { showToast } = useToast();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  // Inline rename — click a member's name to turn it into an input, Enter/blur
  // commits via updateMember, Escape cancels without saving.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const savingIdRef = useRef<number | null>(null);

  const add = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await createMember(trip.id, newName.trim());
      setNewName("");
      onChanged();
      showToast(`已新增成員「${created.name}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "新增成員失敗", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, name: string) => {
    try {
      await deleteMember(id);
      onChanged();
      showToast(`已刪除成員「${name}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "刪除成員失敗（可能已有支出紀錄使用此成員）", "error");
    }
  };

  const startEdit = (m: Member) => {
    setEditingId(m.id);
    setEditName(m.name);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };
  const commitEdit = async (id: number, originalName: string) => {
    if (savingIdRef.current === id) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === originalName) {
      cancelEdit();
      return;
    }
    savingIdRef.current = id;
    try {
      await updateMember(id, trimmed);
      onChanged();
      showToast(`已更新成員名稱為「${trimmed}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新成員失敗", "error");
    } finally {
      savingIdRef.current = null;
      cancelEdit();
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
            {editingId === m.id ? (
              <input
                autoFocus
                className="flex-1 border border-teal-400 rounded px-1.5 py-1 text-[13.5px] outline-none"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => commitEdit(m.id, m.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit(m.id, m.name);
                  if (e.key === "Escape") cancelEdit();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => startEdit(m)}
                title="點擊編輯姓名"
                className="text-[13.5px] text-slate-800 flex-1 text-left hover:text-teal-700 hover:underline"
              >
                {m.name}
              </button>
            )}
            <ConfirmButton
              message={`確定要移除成員「${m.name}」嗎？若此成員已被支出使用，刪除將會失敗。`}
              onConfirm={() => remove(m.id, m.name)}
              className="text-slate-400 hover:text-rose-600 text-sm inline-flex items-center"
            >
              <X size={14} aria-hidden="true" />
            </ConfirmButton>
          </div>
        ))}
        {trip.members.length === 0 && <p className="text-sm text-slate-400 py-2">尚未新增成員</p>}
      </div>
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
          className="border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1"
        >
          <Plus size={13} aria-hidden="true" /> 新增成員
        </button>
      </div>
    </Wrapper>
  );
}
