"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTrip } from "@/lib/TripContext";
import { deleteExpense, listExpenses } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import type { Expense } from "@/lib/types";
import Avatar from "@/components/Avatar";
import { CategoryChip, ExpenseTypeBadge, SplitStatusBadge } from "@/components/Chip";
import { formatDate, formatMoney } from "@/lib/format";
import ExpenseFormDialog from "@/components/ExpenseFormDialog";
import ConfirmButton from "@/components/ConfirmButton";
import Dialog from "@/components/Dialog";
import { ChevronDown, Paperclip, Plus, Trash2 } from "lucide-react";

interface Filters {
  date_from: string;
  date_to: string;
  category_id: string;
  payer_id: string;
  search: string;
}

const EMPTY_FILTERS: Filters = { date_from: "", date_to: "", category_id: "", payer_id: "", search: "" };

export default function ExpensesPageClient({ tripId }: { tripId: number }) {
  const { trip, reload: reloadTrip } = useTrip();
  const router = useRouter();
  const { showToast } = useToast();
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

  const load = () => {
    listExpenses(tripId, {
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      category_id: filters.category_id ? Number(filters.category_id) : undefined,
      payer_id: filters.payer_id ? Number(filters.payer_id) : undefined,
      search: filters.search || undefined,
    })
      .then(setExpenses)
      .catch((e) => setError(e instanceof Error ? e.message : "載入支出失敗"));
  };

  useEffect(load, [tripId, filters]);

  // Income nets *against* the total (same signed convention as
  // routers/trips.py's trip-list-card total and services/settlement.py)
  // rather than adding to it — otherwise logging an income would inflate
  // this "合計", which is meant to read as net spend.
  const total = useMemo(
    () => (expenses ?? []).reduce((sum, e) => sum + (e.type === "income" ? -e.base_amount : e.base_amount), 0),
    [expenses]
  );

  if (!trip) return null;

  const categoryById = new Map(trip.categories.map((c) => [c.id, c]));
  const memberById = new Map(trip.members.map((m) => [m.id, m]));
  const paymentMethodById = new Map(trip.payment_methods.map((pm) => [pm.id, pm]));

  // Guard against entering the expense form when the trip has no members yet
  // — the "payer" dropdown would be empty (backend create_trip doesn't
  // auto-create any members). Covers trips reached via a direct URL or old
  // trips created before the settings-first onboarding flow existed.
  const hasMembers = trip.members.length > 0;

  const openCreate = () => {
    if (!hasMembers) {
      router.push(`/trips/${tripId}/settings`);
      return;
    }
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setFormOpen(true);
  };
  const handleSaved = () => {
    setFormOpen(false);
    load();
    reloadTrip();
  };
  const handleDelete = async (id: number) => {
    try {
      await deleteExpense(tripId, id);
      load();
      reloadTrip();
      showToast("已刪除支出");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "刪除支出失敗", "error");
    }
  };

  // Desktop filter bar: fixed, compact per-field widths, no baked-in
  // `w-full` in the base class. The previous version shared a `filterInputCls`
  // that DID bake in `w-full`, and every desktop control appended a narrower
  // width on top (e.g. `filterInputCls + " w-auto"`) — but that never
  // actually overrode `w-full`: both are single-class Tailwind utilities of
  // equal CSS specificity, so which one wins is decided by their order in
  // Tailwind's generated stylesheet, not by where they appear in the
  // className string. `w-full` happened to win, so every desktop filter
  // control silently stretched to the row's full width and wrapped onto its
  // own line — hence this dedicated class with no width baked in at all.
  // focus:border/ring added so this row's date/select/search controls (incl.
  // the native <input type="date"> filters) share the same focus treatment
  // as every other custom input in the app (e.g. ExpenseFormDialog's
  // inputCls) — previously this class was the one place that native date
  // input's *box* actually already matched visually, but silently lacked
  // the focus ring the rest of the app's inputs have (see
  // uiux-audit-2026-08-12.md §1.1).
  const desktopFilterInputCls =
    "border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";

  return (
    <div className="relative">
      {/* ===== Desktop ===== */}
      <div className="hidden lg:block px-8 py-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-2xl font-bold text-slate-900">支出記帳</p>
          <div className="flex items-center gap-2.5">
            {!hasMembers && (
              <span className="text-xs text-amber-600">此行程尚無成員，請先到設定新增成員</span>
            )}
            <button
              onClick={openCreate}
              title={!hasMembers ? "請先到行程設定新增成員" : undefined}
              aria-disabled={!hasMembers}
              className={
                hasMembers
                  ? "bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm inline-flex items-center gap-1"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed rounded-lg px-4 py-2.5 text-sm font-medium inline-flex items-center gap-1"
              }
            >
              <Plus size={15} aria-hidden="true" /> 新增支出
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3.5">
          <select
            className={desktopFilterInputCls + " w-28 shrink-0"}
            value={filters.category_id}
            onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))}
          >
            <option value="">全部分類</option>
            {trip.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className={desktopFilterInputCls + " w-28 shrink-0"}
            value={filters.payer_id}
            onChange={(e) => setFilters((f) => ({ ...f, payer_id: e.target.value }))}
          >
            <option value="">全部付款人</option>
            {trip.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            className={desktopFilterInputCls + " w-[136px] shrink-0"}
            value={filters.date_from}
            onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
          />
          <span className="text-slate-300 text-xs shrink-0">–</span>
          <input
            type="date"
            className={desktopFilterInputCls + " w-[136px] shrink-0"}
            value={filters.date_to}
            onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
          />
          <input
            className={desktopFilterInputCls + " w-40 shrink-0"}
            placeholder="搜尋項目名稱…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          <div className="flex-1" />
          <span className="text-xs text-slate-400 shrink-0 whitespace-nowrap">
            共 {expenses?.length ?? 0} 筆・合計 {formatMoney(total, trip.base_currency_code)}
          </span>
        </div>

        {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs font-medium">
                <th className="text-left px-3 py-2.5">日期</th>
                <th className="text-left px-3 py-2.5">分類</th>
                <th className="text-left px-3 py-2.5">項目</th>
                <th className="text-right px-3 py-2.5">原幣金額</th>
                <th className="text-right px-3 py-2.5">換算 ({trip.base_currency_code})</th>
                <th className="text-left px-3 py-2.5">付款人</th>
                <th className="text-left px-3 py-2.5">付款方式</th>
                <th className="text-left px-3 py-2.5">分帳狀態</th>
                <th className="text-left px-3 py-2.5">備註</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(expenses ?? []).map((e) => {
                const category = e.category_id ? categoryById.get(e.category_id) : undefined;
                const payer = memberById.get(e.payer_id);
                const pm = e.payment_method_id ? paymentMethodById.get(e.payment_method_id) : undefined;
                const currency = trip.currencies.find((c) => c.id === e.currency_id);
                const allSettled = e.shares.length > 0 && e.shares.every((s) => s.is_settled);
                const isIncome = e.type === "income";
                return (
                  <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50 group">
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="px-3 py-2.5">
                      {category ? <CategoryChip name={category.name} color={category.color} /> : "-"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span>{e.name}</span>
                        <ExpenseTypeBadge type={e.type} compact />
                        {e.image_url && (
                          <span title="這筆有附圖" aria-label="這筆有附圖" className="text-slate-400 inline-flex items-center">
                            <Paperclip size={12} aria-hidden="true" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums text-xs ${
                        isIncome ? "text-emerald-600 font-semibold" : "text-slate-500"
                      }`}
                    >
                      {isIncome ? "+" : ""}
                      {formatMoney(e.amount, currency?.code)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                        isIncome ? "text-emerald-600" : "text-slate-900"
                      }`}
                    >
                      {isIncome ? "+" : ""}
                      {formatMoney(e.base_amount, trip.base_currency_code)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {payer && <Avatar name={payer.name} color={payer.color} size="xs" />}
                        {payer?.name}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{pm?.name ?? "-"}</td>
                    <td className="px-3 py-2.5">
                      <SplitStatusBadge
                        needsSplit={e.needs_split}
                        participantCount={e.shares.length}
                        allSettled={allSettled}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs max-w-[120px] truncate" title={e.note ?? ""}>
                      {e.note || "-"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2 justify-end">
                        <button onClick={() => openEdit(e)} className="text-xs text-slate-500 hover:text-teal-600">
                          編輯
                        </button>
                        <ConfirmButton
                          message={`確定要刪除「${e.name}」這筆支出嗎？`}
                          onConfirm={() => handleDelete(e.id)}
                          className="text-xs text-rose-500 hover:text-rose-700"
                        >
                          刪除
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {expenses && expenses.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-slate-400 text-sm py-10">
                    尚無支出紀錄，點右上角「＋ 新增支出」開始記帳
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Mobile ===== */}
      <div className="lg:hidden px-3.5 py-3.5">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setFilterSheetOpen(true)}
            className="bg-white border border-slate-300 text-slate-600 rounded-lg px-3 py-1.5 text-[11.5px] font-medium inline-flex items-center gap-1"
          >
            篩選 <ChevronDown size={13} aria-hidden="true" />
          </button>
          <span className="text-[11.5px] text-slate-400">
            共 {expenses?.length ?? 0} 筆・合計 {formatMoney(total, trip.base_currency_code)}
          </span>
        </div>

        {!hasMembers && (
          <button
            type="button"
            onClick={() => router.push(`/trips/${tripId}/settings`)}
            className="w-full text-left text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3"
          >
            此行程尚無成員，請先到設定新增成員才能記帳 →
          </button>
        )}

        {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

        <div className="flex flex-col gap-2">
          {(expenses ?? []).map((e) => {
            const category = e.category_id ? categoryById.get(e.category_id) : undefined;
            const payer = memberById.get(e.payer_id);
            const isIncome = e.type === "income";
            return (
              // Card itself opens the edit form on click; the delete icon
              // lives in a sibling overlay (not nested inside the edit
              // button — nesting an interactive <button> inside another is
              // invalid HTML) positioned top-right, same pattern as
              // TripCard.tsx's delete affordance over its clickable Link.
              // Its wrapper stops the click from bubbling so tapping delete
              // never also triggers the card's onClick underneath.
              <div key={e.id} className="relative bg-white border border-slate-200 rounded-[10px]">
                <button
                  type="button"
                  onClick={() => openEdit(e)}
                  className="w-full text-left px-3.5 py-2.5"
                >
                  <div className="flex items-center justify-between mb-1 pr-7">
                    <span className="text-[13.5px] font-semibold text-slate-900 flex items-center gap-1.5 min-w-0">
                      {category && <CategoryChip name={category.name} color={category.color} compact />}
                      <span className="truncate">{e.name}</span>
                      <ExpenseTypeBadge type={e.type} compact />
                      {e.image_url && (
                        <span
                          title="這筆有附圖"
                          aria-label="這筆有附圖"
                          className="text-slate-400 shrink-0 inline-flex items-center"
                        >
                          <Paperclip size={11} aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-[14.5px] font-bold tabular-nums shrink-0 ml-2 ${
                        isIncome ? "text-emerald-600" : "text-slate-900"
                      }`}
                    >
                      {isIncome ? "+" : ""}
                      {formatMoney(e.base_amount, trip.base_currency_code)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span>{formatDate(e.date)}</span>
                    <span>·</span>
                    {payer && <Avatar name={payer.name} color={payer.color} size="xs" />}
                    <SplitStatusBadge
                      needsSplit={e.needs_split}
                      participantCount={e.shares.length}
                      allSettled={e.shares.length > 0 && e.shares.every((s) => s.is_settled)}
                    />
                  </div>
                </button>
                <div className="absolute top-2 right-2" onClick={(ev) => ev.stopPropagation()}>
                  <ConfirmButton
                    message={`確定要刪除「${e.name}」這筆支出嗎？`}
                    onConfirm={() => handleDelete(e.id)}
                    className="w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 flex items-center justify-center"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </ConfirmButton>
                </div>
              </div>
            );
          })}
          {expenses && expenses.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-10">
              尚無支出紀錄，點右下角「＋」開始記帳
            </p>
          )}
        </div>

        <button
          onClick={openCreate}
          aria-label="新增支出"
          title={!hasMembers ? "請先到行程設定新增成員" : undefined}
          aria-disabled={!hasMembers}
          className={`fixed bottom-20 right-4 w-14 h-14 rounded-full shadow-lg flex items-center justify-center z-20 ${
            hasMembers ? "bg-teal-600 text-white" : "bg-slate-300 text-slate-500"
          }`}
        >
          <Plus size={24} aria-hidden="true" />
        </button>
      </div>

      <Dialog open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="篩選">
        <div className="space-y-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">分類</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
              value={filters.category_id}
              onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))}
            >
              <option value="">全部分類</option>
              {trip.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">付款人</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
              value={filters.payer_id}
              onChange={(e) => setFilters((f) => ({ ...f, payer_id: e.target.value }))}
            >
              <option value="">全部付款人</option>
              {trip.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">起始日期</label>
              <input
                type="date"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
                value={filters.date_from}
                onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">結束日期</label>
              <input
                type="date"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
                value={filters.date_to}
                onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">搜尋項目名稱</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              className="flex-1 bg-white border border-slate-300 text-slate-700 rounded-lg py-2.5 text-sm font-medium"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              清除篩選
            </button>
            <button
              className="flex-1 bg-teal-600 text-white rounded-lg py-2.5 text-sm font-medium"
              onClick={() => setFilterSheetOpen(false)}
            >
              套用
            </button>
          </div>
        </div>
      </Dialog>

      <ExpenseFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        tripId={tripId}
        trip={trip}
        expense={editing}
        onSaved={handleSaved}
        onTripChanged={reloadTrip}
      />
    </div>
  );
}
