"use client";

import { useEffect, useState } from "react";
import { useTrip } from "@/lib/TripContext";
import { getSettlement } from "@/lib/api";
import type { Member, MemberSettlement, Settlement, TransferSuggestion } from "@/lib/types";
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
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>應分攤總額</span>
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
}: {
  transfer: TransferSuggestion;
  memberById: Map<number, Member>;
  currency: string | null;
}) {
  const from = memberById.get(transfer.from_member_id);
  const to = memberById.get(transfer.to_member_id);
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-3 border border-slate-200 rounded-[10px] bg-white">
      <span className="w-4 h-4 border border-slate-300 rounded shrink-0" />
      {from && <Avatar name={from.name} color={from.color} size="sm" />}
      <span className="text-[13px] font-semibold text-slate-800">{from?.name}</span>
      <span className="text-slate-400">→</span>
      {to && <Avatar name={to.name} color={to.color} size="sm" />}
      <span className="text-[13px] font-semibold text-slate-800">{to?.name}</span>
      <span className="ml-auto text-[15px] font-bold tabular-nums text-slate-900">
        {formatMoney(transfer.amount, currency ?? undefined)}
      </span>
    </div>
  );
}

function TransferList({
  transfers,
  memberById,
  currency,
}: {
  transfers: TransferSuggestion[];
  memberById: Map<number, Member>;
  currency: string | null;
}) {
  if (transfers.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">帳目已平衡，無需轉帳</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {transfers.map((t, i) => (
        <TransferCard key={i} transfer={t} memberById={memberById} currency={currency} />
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

export default function SettlementPageClient({ tripId }: { tripId: number }) {
  const { trip } = useTrip();
  const [currency, setCurrency] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"overview" | "detail" | "transfers">("overview");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default once trip loads
    if (trip && !currency) setCurrency(trip.base_currency_code);
  }, [trip, currency]);

  useEffect(() => {
    if (!currency) return;
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
  }, [tripId, currency]);

  if (!trip) return null;

  const memberById = new Map(trip.members.map((m) => [m.id, m]));
  const zeroSuppress = (amount: number) => (amount === 0 ? "—" : formatMoney(amount, currency ?? undefined));
  const currencyCodes = trip.currencies.map((c) => c.code);

  return (
    <div>
      {error && <p className="text-sm text-rose-600 px-4 md:px-8 pt-4">{error}</p>}

      {/* ===== Desktop ===== */}
      <div className="hidden lg:block px-8 py-5">
        <div className="flex items-center justify-between mb-5">
          <p className="text-2xl font-bold text-slate-900">結算總覽</p>
          <CurrencySegmentedControl codes={currencyCodes} currency={currency} onChange={setCurrency} />
        </div>

        <div className="grid grid-cols-3 gap-3.5 mb-5">
          {settlement?.members.map((m) => (
            <MemberSummaryCard key={m.member_id} member={m} currency={currency} />
          ))}
        </div>

        <div className="grid grid-cols-[1.4fr_1fr] gap-5">
          <Card>
            <p className="text-sm font-semibold text-slate-900 mb-1">誰欠誰矩陣</p>
            <p className="text-[11.5px] text-slate-500 mb-3.5">
              列＝債務人（付錢的一方）・欄＝債權人（收錢的一方），單位 {currency}
            </p>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr>
                  <th className="text-left bg-slate-50 text-slate-500 text-[11px] font-semibold py-2 px-2.5 border-b border-slate-200" />
                  {trip.members.map((m) => (
                    <th
                      key={m.id}
                      className="bg-slate-50 text-slate-500 text-[11px] font-semibold py-2 px-2.5 border-b border-slate-200"
                    >
                      {m.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trip.members.map((rowMember) => (
                  <tr key={rowMember.id} className="border-b border-slate-100">
                    <td className="py-2.5 px-2.5 font-semibold text-slate-800 flex items-center gap-1.5">
                      <Avatar name={rowMember.name} color={rowMember.color} size="xs" />
                      {rowMember.name}
                    </td>
                    {trip.members.map((colMember) => {
                      if (colMember.id === rowMember.id) {
                        return (
                          <td
                            key={colMember.id}
                            className="text-center py-2.5 px-2.5"
                            style={{
                              background:
                                "repeating-linear-gradient(135deg, #f1f5f9, #f1f5f9 4px, #fff 4px, #fff 8px)",
                            }}
                          />
                        );
                      }
                      const cell = settlement?.matrix.find(
                        (c) => c.debtor_id === rowMember.id && c.creditor_id === colMember.id
                      );
                      const amt = cell?.amount ?? 0;
                      return (
                        <td
                          key={colMember.id}
                          className={`text-center py-2.5 px-2.5 tabular-nums ${
                            amt > 0 ? "text-rose-600 font-semibold" : "text-slate-300"
                          }`}
                        >
                          {zeroSuppress(amt)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <p className="text-sm font-semibold text-slate-900 mb-1">最終結算建議</p>
            <p className="text-[11.5px] text-slate-500 mb-3.5">
              已簡化為 {settlement?.suggested_transfers.length ?? 0} 筆轉帳（原始 {settlement?.raw_relationship_count ?? 0}{" "}
              組欠款關係
              {settlement && settlement.raw_relationship_count === settlement.suggested_transfers.length && "，本例已是最簡"}
              ）
            </p>
            <TransferList transfers={settlement?.suggested_transfers ?? []} memberById={memberById} currency={currency} />
          </Card>
        </div>
      </div>

      {/* ===== Mobile ===== */}
      <div className="lg:hidden px-3.5 py-3.5">
        <div className="flex justify-center mb-3.5">
          <CurrencySegmentedControl codes={currencyCodes} currency={currency} onChange={setCurrency} />
        </div>
        <div className="flex gap-1.5 mb-3.5">
          {[
            { key: "overview", label: "總覽" },
            { key: "detail", label: "明細" },
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
          </div>
        )}

        {mobileTab === "detail" && (
          <Card className="p-1.5">
            {settlement?.matrix.map((cell, i) => {
              const debtor = memberById.get(cell.debtor_id);
              const creditor = memberById.get(cell.creditor_id);
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 last:border-b-0 text-[13px]"
                >
                  {debtor && <Avatar name={debtor.name} color={debtor.color} size="sm" />}
                  <span className="flex-1">
                    {debtor?.name} 欠 {creditor?.name}
                  </span>
                  <span className="font-bold tabular-nums text-rose-600">
                    {formatMoney(cell.amount, currency ?? undefined)}
                  </span>
                </div>
              );
            })}
            {settlement?.matrix.length === 0 && <p className="text-sm text-slate-400 text-center py-8">目前沒有欠款關係</p>}
          </Card>
        )}

        {mobileTab === "transfers" && (
          <>
            <p className="text-[11.5px] text-slate-500 mb-3">已簡化為 {settlement?.suggested_transfers.length ?? 0} 筆轉帳</p>
            <TransferList transfers={settlement?.suggested_transfers ?? []} memberById={memberById} currency={currency} />
          </>
        )}
      </div>
    </div>
  );
}
