"use client";

import { useEffect, useState } from "react";
import { useTrip } from "@/lib/TripContext";
import { getSettlement, getSettlementByCurrency } from "@/lib/api";
import type { CategoryBreakdownItem, Member, MemberSettlement, NativeSettlement, Settlement, TransferSuggestion } from "@/lib/types";
import Avatar from "@/components/Avatar";
import Card from "@/components/Card";
import { formatMoney, formatSignedMoney } from "@/lib/format";

function MemberSummaryCard({ member, currency }: { member: MemberSettlement; currency: string | null }) {
  return (
    <Card className="p-4 md:p-[18px]">
      <div className="flex items-center gap-2 mb-3">
        <Avatar name={member.name} color={member.color} size="md" />
        <span className="text-sm font-semibold text-slate-900">{member.name}</span>
      </div>
      {/* total_owed = 這個人這趟旅行分攤到、該花的總額 = 個人總花費（見
          backend SettlementOut.trip_total_spend 的關係：所有成員 total_owed
          加總 = trip_total_spend）。標籤直接叫「個人總花費」，不再用內部
          記帳用語「應分攤總額」，避免使用者要多轉譯一次。 */}
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>個人總花費</span>
        <b className="text-slate-700 font-semibold tabular-nums">
          {formatMoney(member.total_owed, currency ?? undefined)}
        </b>
      </div>
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>實際支付總額</span>
        <b className="text-slate-700 font-semibold tabular-nums">
          {formatMoney(member.total_paid, currency ?? undefined)}
        </b>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-baseline gap-1.5">
        <span
          className={`text-xl md:text-2xl font-bold tabular-nums ${
            member.net >= 0 ? "text-emerald-600" : "text-rose-600"
          }`}
        >
          {formatSignedMoney(member.net, currency ?? undefined)}
        </span>
        <span className={`text-[11px] font-semibold ${member.net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {member.net >= 0 ? "應收" : "應付"}
        </span>
      </div>
    </Card>
  );
}

function TransferCard({
  transfer,
  memberById,
  currency,
  checked,
  onToggle,
}: {
  transfer: TransferSuggestion;
  memberById: Map<number, Member>;
  currency: string | null;
  /** "I've actually sent this transfer" — purely a local self-check mark,
   * not persisted (see checkedTransfers in SettlementPageClient below). */
  checked: boolean;
  onToggle: () => void;
}) {
  const from = memberById.get(transfer.from_member_id);
  const to = memberById.get(transfer.to_member_id);
  return (
    <label
      className={`flex items-center gap-2.5 px-3.5 py-3 border rounded-[10px] cursor-pointer transition-colors ${
        checked ? "bg-slate-50 border-slate-100" : "bg-white border-slate-200"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`標記 ${from?.name ?? ""} → ${to?.name ?? ""} 已轉帳`}
        className="w-4 h-4 accent-teal-600 rounded shrink-0 cursor-pointer"
      />
      {from && <Avatar name={from.name} color={from.color} size="sm" />}
      <span className={`text-[13px] font-semibold ${checked ? "text-slate-400 line-through" : "text-slate-800"}`}>
        {from?.name}
      </span>
      <span className="text-slate-400">→</span>
      {to && <Avatar name={to.name} color={to.color} size="sm" />}
      <span className={`text-[13px] font-semibold ${checked ? "text-slate-400 line-through" : "text-slate-800"}`}>
        {to?.name}
      </span>
      <span
        className={`ml-auto text-[15px] font-bold tabular-nums ${
          checked ? "text-slate-400 line-through" : "text-slate-900"
        }`}
      >
        {formatMoney(transfer.amount, currency ?? undefined)}
      </span>
    </label>
  );
}

function TransferList({
  transfers,
  memberById,
  currency,
  checkedTransfers,
  onToggleTransfer,
}: {
  transfers: TransferSuggestion[];
  memberById: Map<number, Member>;
  currency: string | null;
  checkedTransfers: Set<number>;
  onToggleTransfer: (key: number) => void;
}) {
  if (transfers.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">帳目已平衡，無需轉帳</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {transfers.map((t, i) => (
        <TransferCard
          key={i}
          transfer={t}
          memberById={memberById}
          currency={currency}
          checked={checkedTransfers.has(i)}
          onToggle={() => onToggleTransfer(i)}
        />
      ))}
    </div>
  );
}

function CurrencySegmentedControl({
  codes,
  currency,
  onChange,
}: {
  codes: string[];
  currency: string | null;
  onChange: (code: string) => void;
}) {
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-1">
      {codes.map((code) => (
        <button
          key={code}
          onClick={() => onChange(code)}
          className={`text-xs md:text-[12.5px] font-semibold px-3 md:px-4 py-1.5 rounded-md ${
            currency === code ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
          }`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

type SettlementMode = "unified" | "by-currency";

/** Mirrors CurrencySegmentedControl's visual language (same "選中 = 白底陰影"
 * segmented-control pattern already used across this page) for the new
 * 統一換算／依原幣別分開 toggle, so the two controls read as one family. */
function ModeSegmentedControl({ mode, onChange }: { mode: SettlementMode; onChange: (mode: SettlementMode) => void }) {
  const options: [SettlementMode, string][] = [
    ["unified", "統一換算"],
    ["by-currency", "依原幣別分開"],
  ];
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`text-xs md:text-[12.5px] font-semibold px-3 md:px-4 py-1.5 rounded-md whitespace-nowrap ${
            mode === key ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function TransferSuggestionCard({
  settlement,
  currency,
  memberById,
  checkedTransfers,
  onToggleTransfer,
}: {
  settlement: Settlement;
  currency: string | null;
  memberById: Map<number, Member>;
  checkedTransfers: Set<number>;
  onToggleTransfer: (key: number) => void;
}) {
  return (
    <Card>
      <p className="text-sm font-semibold text-slate-900 mb-1">最終結算建議</p>
      <p className="text-[11.5px] text-slate-500 mb-3.5">
        已簡化為 {settlement.suggested_transfers.length} 筆轉帳（原始 {settlement.raw_relationship_count} 組欠款關係
        {settlement.raw_relationship_count === settlement.suggested_transfers.length && "，本例已是最簡"}）
      </p>
      <TransferList
        transfers={settlement.suggested_transfers}
        memberById={memberById}
        currency={currency}
        checkedTransfers={checkedTransfers}
        onToggleTransfer={onToggleTransfer}
      />
    </Card>
  );
}

/** 頁面最上方的「旅程總花費」／「初始金額」／「剩餘」對比列 — 只在「統一換算」
 * 模式顯示（依原幣別分開模式下不同幣別金額不能直接相加，沒有一個有意義的
 * 合計數字可比較）。initialAmountDisplay 是「初始換匯」紀錄的換入金額
 * （trip.initial_exchange_to_amount），已經換算到目前選定幣別後的數字
 * （見 SettlementPageClient 的換算邏輯），沒填這筆換匯紀錄則只顯示旅程總花費。 */
function BudgetSummaryBar({
  tripTotalSpend,
  initialAmountDisplay,
  currency,
}: {
  tripTotalSpend: number;
  initialAmountDisplay: number | null;
  currency: string | null;
}) {
  const remaining = initialAmountDisplay != null ? initialAmountDisplay - tripTotalSpend : null;
  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
        <div>
          <p className="text-[11.5px] text-slate-500 mb-0.5">旅程總花費</p>
          {/* text-xl md:text-2xl font-bold tabular-nums = 同一份「金額（強調）」
              字級規格，MemberSummaryCard 的淨額大字也是這組 class，全站強調
              金額一致，不再另外開一個 26px 的一次性尺寸。 */}
          <p className="text-xl md:text-2xl font-bold tabular-nums text-slate-900">
            {formatMoney(tripTotalSpend, currency ?? undefined)}
          </p>
        </div>
        {initialAmountDisplay != null && remaining != null && (
          <>
            <div className="h-9 w-px bg-slate-100 self-center hidden sm:block" />
            <div>
              <p className="text-[11.5px] text-slate-500 mb-0.5">初始金額</p>
              <p className="text-lg font-semibold tabular-nums text-slate-700">
                {formatMoney(initialAmountDisplay, currency ?? undefined)}
              </p>
            </div>
            <div>
              <p className="text-[11.5px] text-slate-500 mb-0.5">剩餘</p>
              <p
                className={`text-lg font-semibold tabular-nums ${
                  remaining >= 0 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {formatMoney(remaining, currency ?? undefined)}
              </p>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/** 依分類的花費比例甜甜圈圖 — 純 CSS conic-gradient，不引入圖表庫。顏色直接
 * 使用後端回傳的 category.color（與分類徽章同一組色票），不自己另外配色。 */
function CategoryPieChart({ items, currency }: { items: CategoryBreakdownItem[]; currency: string | null }) {
  if (items.length === 0) return null;
  const stops = items.reduce<{ text: string[]; cumulative: number }>(
    (acc, item) => {
      const start = acc.cumulative;
      const end = Math.min(100, acc.cumulative + item.percentage);
      return { text: [...acc.text, `${item.color} ${start}% ${end}%`], cumulative: end };
    },
    { text: [], cumulative: 0 }
  ).text;
  const gradient = `conic-gradient(${stops.join(", ")})`;
  return (
    <Card>
      <p className="text-sm font-semibold text-slate-900 mb-1">依分類花費比例</p>
      <p className="text-[11.5px] text-slate-500 mb-4">僅計入支出（不含收入），單位 {currency}</p>
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
        <div className="relative w-32 h-32 shrink-0 rounded-full" style={{ background: gradient }}>
          <div className="absolute inset-[18%] bg-white rounded-full flex flex-col items-center justify-center">
            <span className="text-base font-bold text-slate-900">{items.length}</span>
            <span className="text-[10px] text-slate-400">個分類</span>
          </div>
        </div>
        <div className="flex-1 w-full space-y-1.5 min-w-0">
          {items.map((item) => (
            <div key={item.category_id ?? "uncategorized"} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-slate-700 truncate flex-1">{item.name}</span>
              <span className="text-slate-400 tabular-nums shrink-0">{item.percentage.toFixed(1)}%</span>
              <span className="text-slate-900 font-semibold tabular-nums shrink-0 w-[76px] text-right">
                {formatMoney(item.amount, currency ?? undefined)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default function SettlementPageClient({ tripId }: { tripId: number }) {
  const { trip } = useTrip();
  const [mode, setMode] = useState<SettlementMode>("unified");
  const [currency, setCurrency] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [nativeSettlement, setNativeSettlement] = useState<NativeSettlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"overview" | "transfers">("overview");
  // "已轉帳" self-check marks for the suggested-transfer list — purely local
  // UI state (keyed by each transfer's index in settlement.suggested_transfers),
  // intentionally NOT persisted to the backend: the suggested-transfer list
  // itself is recomputed from scratch on every load rather than backed by a
  // stable DB row, so there's nothing meaningful to attach a saved flag to.
  // Resetting on refresh is an accepted tradeoff (see task spec).
  const [checkedTransfers, setCheckedTransfers] = useState<Set<number>>(new Set());
  const toggleTransferChecked = (key: number) => {
    setCheckedTransfers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  // Same idea as checkedTransfers above, but keyed per currency code since
  // "依原幣別分開" mode shows one independent transfer list per currency.
  const [checkedByCurrency, setCheckedByCurrency] = useState<Record<string, Set<number>>>({});
  const toggleCurrencyTransferChecked = (code: string, key: number) => {
    setCheckedByCurrency((prev) => {
      const current = prev[code] ?? new Set<number>();
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [code]: next };
    });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default once trip loads
    if (trip && !currency) setCurrency(trip.base_currency_code);
  }, [trip, currency]);

  useEffect(() => {
    if (mode !== "unified" || !currency) return;
    let cancelled = false;
    getSettlement(tripId, currency)
      .then((data) => {
        if (!cancelled) setSettlement(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "載入結算失敗");
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, currency, mode]);

  useEffect(() => {
    if (mode !== "by-currency") return;
    let cancelled = false;
    getSettlementByCurrency(tripId)
      .then((data) => {
        if (!cancelled) setNativeSettlement(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "載入結算失敗");
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, mode]);

  if (!trip) return null;

  const memberById = new Map(trip.members.map((m) => [m.id, m]));
  const currencyCodes = trip.currencies.map((c) => c.code);

  // "初始金額" now comes from the initial-exchange record's *to* amount
  // (trip.initial_exchange_to_amount — the currency the user actually
  // carried while traveling), not the legacy trip.initial_budget. It's
  // denominated in trip.initial_exchange_to_currency, which is independent
  // of both the trip's base currency and this record's own
  // initial_exchange_rate (that rate is just the user's personal memo of
  // what they actually got at the exchange booth). To compare against
  // trip_total_spend (already in the currently-selected display currency),
  // convert via this trip's live `currencies` rate table like every other
  // amount in the app: amount_in_code * rate_to_base = amount_in_base, then
  // / selectedCurrency.rate_to_base to reach the display currency. Only
  // resolvable when initial_exchange_to_currency matches one of this trip's
  // tracked currencies; otherwise (or when the record was never filled in)
  // the comparison stays hidden, same as the old initial_budget behavior.
  const selectedCurrency = trip.currencies.find((c) => c.code === currency);
  const initialAmountCurrency = trip.currencies.find((c) => c.code === trip.initial_exchange_to_currency);
  const initialAmountDisplay =
    trip.initial_exchange_to_amount != null && initialAmountCurrency && selectedCurrency
      ? (trip.initial_exchange_to_amount * initialAmountCurrency.rate_to_base) / selectedCurrency.rate_to_base
      : null;

  return (
    <div>
      {error && <p className="text-sm text-rose-600 px-4 md:px-8 pt-4">{error}</p>}

      {/* ===== Desktop ===== */}
      <div className="hidden lg:block px-8 py-5">
        <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
          <p className="text-2xl font-bold text-slate-900">結算總覽</p>
          <div className="flex items-center gap-2.5">
            <ModeSegmentedControl mode={mode} onChange={setMode} />
            {mode === "unified" && <CurrencySegmentedControl codes={currencyCodes} currency={currency} onChange={setCurrency} />}
          </div>
        </div>

        {mode === "unified" && (
          <>
            <BudgetSummaryBar
              tripTotalSpend={settlement?.trip_total_spend ?? 0}
              initialAmountDisplay={initialAmountDisplay}
              currency={currency}
            />

            <div className="grid grid-cols-3 gap-3.5 mb-5">
              {settlement?.members.map((m) => (
                <MemberSummaryCard key={m.member_id} member={m} currency={currency} />
              ))}
            </div>

            {/* "誰欠誰矩陣" card used to sit here in a 2-col grid alongside
                the transfer suggestions — removed per user feedback, so this
                card now just takes a comfortable single-card width of its
                own instead of stretching edge-to-edge. */}
            {settlement && (
              <div className="max-w-xl mb-5">
                <TransferSuggestionCard
                  settlement={settlement}
                  currency={currency}
                  memberById={memberById}
                  checkedTransfers={checkedTransfers}
                  onToggleTransfer={toggleTransferChecked}
                />
              </div>
            )}

            {settlement && <CategoryPieChart items={settlement.category_breakdown} currency={currency} />}
          </>
        )}

        {mode === "by-currency" && (
          <div className="space-y-7">
            {nativeSettlement?.results.map((s) => (
              <div key={s.currency_code}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold bg-teal-50 text-teal-700">
                    {s.currency_code}
                  </span>
                  <span className="text-sm text-slate-500">
                    此幣別旅程總花費 <b className="text-slate-800 font-semibold tabular-nums">{formatMoney(s.trip_total_spend, s.currency_code)}</b>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3.5 mb-3.5">
                  {s.members.map((m) => (
                    <MemberSummaryCard key={m.member_id} member={m} currency={s.currency_code} />
                  ))}
                </div>
                <div className="max-w-xl">
                  <TransferSuggestionCard
                    settlement={s}
                    currency={s.currency_code}
                    memberById={memberById}
                    checkedTransfers={checkedByCurrency[s.currency_code] ?? new Set()}
                    onToggleTransfer={(key) => toggleCurrencyTransferChecked(s.currency_code, key)}
                  />
                </div>
              </div>
            ))}
            {nativeSettlement && nativeSettlement.results.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-16">尚無支出紀錄，沒有可分開結算的幣別</p>
            )}
          </div>
        )}
      </div>

      {/* ===== Mobile ===== */}
      <div className="lg:hidden px-3.5 py-3.5">
        <div className="flex justify-center mb-3.5">
          <ModeSegmentedControl mode={mode} onChange={setMode} />
        </div>

        {mode === "unified" && (
          <>
            <div className="flex justify-center mb-3.5">
              <CurrencySegmentedControl codes={currencyCodes} currency={currency} onChange={setCurrency} />
            </div>
            <BudgetSummaryBar
              tripTotalSpend={settlement?.trip_total_spend ?? 0}
              initialAmountDisplay={initialAmountDisplay}
              currency={currency}
            />
            {/* "明細" tab (誰欠誰矩陣的手機敘述式版本) removed along with the
                matrix — down to 2 tabs now, "建議轉帳" is still worth its own
                tab since it has its own checklist interaction. */}
            <div className="flex gap-1.5 mb-3.5">
              {[
                { key: "overview", label: "總覽" },
                { key: "transfers", label: "建議轉帳" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setMobileTab(t.key as typeof mobileTab)}
                  className={`flex-1 text-center text-[12.5px] font-semibold py-2 rounded-lg ${
                    mobileTab === t.key ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {mobileTab === "overview" && (
              <div className="flex flex-col gap-2.5">
                {settlement?.members.map((m) => (
                  <MemberSummaryCard key={m.member_id} member={m} currency={currency} />
                ))}
                {settlement && <CategoryPieChart items={settlement.category_breakdown} currency={currency} />}
              </div>
            )}

            {mobileTab === "transfers" && settlement && (
              <>
                <p className="text-[11.5px] text-slate-500 mb-3">已簡化為 {settlement.suggested_transfers.length} 筆轉帳</p>
                <TransferList
                  transfers={settlement.suggested_transfers}
                  memberById={memberById}
                  currency={currency}
                  checkedTransfers={checkedTransfers}
                  onToggleTransfer={toggleTransferChecked}
                />
              </>
            )}
          </>
        )}

        {mode === "by-currency" && (
          <div className="space-y-6">
            {nativeSettlement?.results.map((s) => (
              <div key={s.currency_code}>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-teal-50 text-teal-700">
                    {s.currency_code}
                  </span>
                  <span className="text-xs text-slate-500">
                    總花費 <b className="text-slate-800 font-semibold tabular-nums">{formatMoney(s.trip_total_spend, s.currency_code)}</b>
                  </span>
                </div>
                <div className="flex flex-col gap-2 mb-2.5">
                  {s.members.map((m) => (
                    <MemberSummaryCard key={m.member_id} member={m} currency={s.currency_code} />
                  ))}
                </div>
                <p className="text-[11px] font-semibold text-slate-600 mb-1.5">
                  建議轉帳（已簡化為 {s.suggested_transfers.length} 筆）
                </p>
                <TransferList
                  transfers={s.suggested_transfers}
                  memberById={memberById}
                  currency={s.currency_code}
                  checkedTransfers={checkedByCurrency[s.currency_code] ?? new Set()}
                  onToggleTransfer={(key) => toggleCurrencyTransferChecked(s.currency_code, key)}
                />
              </div>
            ))}
            {nativeSettlement && nativeSettlement.results.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-14">尚無支出紀錄，沒有可分開結算的幣別</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
