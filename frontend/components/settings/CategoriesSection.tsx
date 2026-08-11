"use client";

import { useRef, useState } from "react";
import Card from "@/components/Card";
import ConfirmButton from "@/components/ConfirmButton";
import { CategoryChip } from "@/components/Chip";
import { createCategory, deleteCategory, resetCategories, updateCategory } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import type { Category, TripDetail } from "@/lib/types";

export default function CategoriesSection({
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

  // Inline rename (+ optional color) — click a chip's name to turn it into
  // an editable row, Enter/blur commits via updateCategory, Escape cancels.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const savingIdRef = useRef<number | null>(null);
  const resettingRef = useRef(false);

  const add = async () => {
    if (!name.trim()) return setAdding(false);
    try {
      await createCategory(trip.id, { name: name.trim() });
      setName("");
      setAdding(false);
      onChanged();
      showToast(`已新增分類「${name.trim()}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "新增分類失敗", "error");
    }
  };

  const remove = async (id: number, name: string) => {
    // Category deletion is DB-safe (Expense.category_id is ondelete="SET
    // NULL", see models.py) — it never fails because a category is in use,
    // it just clears that field on the affected expenses. Say so explicitly
    // instead of the old "可能會失敗" wording, which was inaccurate.
    if (
      !window.confirm(`確定要刪除分類「${name}」嗎？已使用此分類的支出將自動變更為「未分類」。`)
    )
      return;
    try {
      await deleteCategory(id);
      onChanged();
      showToast(`已刪除分類「${name}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "刪除分類失敗", "error");
    }
  };

  const startEdit = (c: Category) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditColor(c.color);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditColor("");
  };
  const commitEdit = async (c: Category) => {
    if (savingIdRef.current === c.id) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    if (trimmed === c.name && editColor === c.color) {
      cancelEdit();
      return;
    }
    savingIdRef.current = c.id;
    try {
      await updateCategory(c.id, { name: trimmed, color: editColor || undefined });
      onChanged();
      showToast(`已更新分類「${trimmed}」`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新分類失敗", "error");
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
      await resetCategories(trip.id);
      onChanged();
      showToast("分類已重設為預設清單");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "重設分類失敗", "error");
    } finally {
      resettingRef.current = false;
      setResetting(false);
    }
  };

  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper id="section-categories">
      {!bare && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm md:text-base font-semibold text-slate-900">分類</p>
          <ConfirmButton
            message="確定要重設分類嗎？將清空目前所有分類，並改回預設的 7 個分類（吃喝／移動／購物／票券／住宿／機票／娛樂）；已使用中的支出會自動變成「未分類」。"
            onConfirm={resetToDefaults}
            className="text-[11px] text-slate-400 hover:text-rose-600 font-medium disabled:opacity-50"
          >
            {resetting ? "重設中…" : "重設為預設"}
          </ConfirmButton>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 items-center">
        {trip.categories.map((c) =>
          editingId === c.id ? (
            <div
              key={c.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-teal-400 bg-white pl-2 pr-1.5 py-1"
            >
              <input
                type="color"
                value={editColor}
                onChange={(e) => setEditColor(e.target.value)}
                title="分類顏色"
                className="w-3.5 h-3.5 rounded-full border-0 p-0 cursor-pointer shrink-0"
              />
              <input
                autoFocus
                className="w-20 text-xs outline-none"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => commitEdit(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit(c);
                  if (e.key === "Escape") cancelEdit();
                }}
              />
            </div>
          ) : (
            <CategoryChip
              key={c.id}
              name={c.name}
              color={c.color}
              onNameClick={() => startEdit(c)}
              onRemove={() => remove(c.id, c.name)}
            />
          )
        )}
        {adding ? (
          <input
            autoFocus
            className="border border-dashed border-slate-300 rounded-full px-3 py-1 text-xs text-slate-600 outline-none"
            placeholder="分類名稱"
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
            ＋ 新增分類
          </button>
        )}
      </div>
      {bare && (
        <div className="mt-3">
          <ConfirmButton
            message="確定要重設分類嗎？將清空目前所有分類，並改回預設的 7 個分類（吃喝／移動／購物／票券／住宿／機票／娛樂）；已使用中的支出會自動變成「未分類」。"
            onConfirm={resetToDefaults}
            className="text-[11px] text-slate-400 hover:text-rose-600 font-medium disabled:opacity-50"
          >
            {resetting ? "重設中…" : "重設為預設"}
          </ConfirmButton>
        </div>
      )}
    </Wrapper>
  );
}
