"use client";

import { useState } from "react";
import { useTrip } from "@/lib/TripContext";
import TripInfoSection from "@/components/settings/TripInfoSection";
import MembersSection from "@/components/settings/MembersSection";
import CurrenciesSection from "@/components/settings/CurrenciesSection";
import CategoriesSection from "@/components/settings/CategoriesSection";
import PaymentMethodsSection from "@/components/settings/PaymentMethodsSection";

const SECTIONS = [
  { key: "info", label: "行程資訊", anchor: "section-info" },
  { key: "members", label: "成員", anchor: "section-members" },
  { key: "currencies", label: "幣別匯率", anchor: "section-currencies" },
  { key: "categories", label: "分類", anchor: "section-categories" },
  { key: "payment-methods", label: "付款方式", anchor: "section-payment-methods" },
] as const;

export default function SettingsPageClient({
  justCreated = false,
}: {
  tripId: number;
  justCreated?: boolean;
}) {
  const { trip, reload } = useTrip();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["info", "members"]));
  const [activeAnchor, setActiveAnchor] = useState("section-info");
  const [showCreatedBanner, setShowCreatedBanner] = useState(justCreated);

  if (!trip) return null;

  const createdBanner = showCreatedBanner && (
    <div className="flex items-start gap-2.5 bg-teal-50 border border-teal-200 text-teal-800 rounded-xl px-4 py-3 text-[13px] leading-relaxed">
      <span className="text-base leading-none">🎉</span>
      <p className="flex-1">
        行程建立成功！請先新增成員與確認幣別匯率，再開始記帳 —— 未新增成員前無法選擇付款人。
      </p>
      <button
        type="button"
        aria-label="關閉提示"
        onClick={() => setShowCreatedBanner(false)}
        className="text-teal-500 hover:text-teal-700 leading-none"
      >
        ✕
      </button>
    </div>
  );

  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const sections = [
    {
      key: "info",
      full: <TripInfoSection trip={trip} onChanged={reload} />,
      bare: <TripInfoSection trip={trip} onChanged={reload} bare />,
    },
    {
      key: "members",
      full: <MembersSection trip={trip} onChanged={reload} />,
      bare: <MembersSection trip={trip} onChanged={reload} bare />,
    },
    {
      key: "currencies",
      full: <CurrenciesSection trip={trip} onChanged={reload} />,
      bare: <CurrenciesSection trip={trip} onChanged={reload} bare />,
    },
    {
      key: "categories",
      full: <CategoriesSection trip={trip} onChanged={reload} />,
      bare: <CategoriesSection trip={trip} onChanged={reload} bare />,
    },
    {
      key: "payment-methods",
      full: <PaymentMethodsSection trip={trip} onChanged={reload} />,
      bare: <PaymentMethodsSection trip={trip} onChanged={reload} bare />,
    },
  ];

  return (
    <div>
      {/* ===== Desktop ===== */}
      <div className="hidden lg:flex gap-8 px-8 py-6 max-w-screen-xl mx-auto">
        <div className="w-48 shrink-0 sticky top-[64px] self-start">
          <p className="text-xl font-bold text-slate-900 mb-4">行程設定</p>
          <nav className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <a
                key={s.key}
                href={`#${s.anchor}`}
                onClick={() => setActiveAnchor(s.anchor)}
                className={`px-2.5 py-1.5 rounded-lg text-[13px] ${
                  activeAnchor === s.anchor ? "bg-teal-50 text-teal-700 font-semibold" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {createdBanner}
          {sections.map((s) => (
            <div key={s.key}>{s.full}</div>
          ))}
        </div>
      </div>

      {/* ===== Mobile ===== */}
      <div className="lg:hidden px-3.5 py-3.5 flex flex-col gap-2.5">
        {createdBanner}
        {SECTIONS.map((s, i) => {
          const isOpen = openSections.has(s.key);
          return (
            <div key={s.key} className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <button
                onClick={() => toggleSection(s.key)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-semibold text-slate-900"
              >
                {s.label}
                <span className="text-[11px] text-slate-400">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && <div className="px-4 pb-4 -mt-1">{sections[i].bare}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
