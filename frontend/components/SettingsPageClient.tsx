"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTrip } from "@/lib/TripContext";
import TripInfoSection from "@/components/settings/TripInfoSection";
import PeopleSection from "@/components/settings/PeopleSection";
import CurrenciesSection from "@/components/settings/CurrenciesSection";
import CategoriesSection from "@/components/settings/CategoriesSection";
import PaymentMethodsSection from "@/components/settings/PaymentMethodsSection";
import DangerZoneSection from "@/components/settings/DangerZoneSection";

// "成員" now covers what used to be two separate sections (split-accounting
// Members + TripAccess/邀請 sharing) merged into one — see
// components/settings/PeopleSection.tsx's docstring for why.
const SECTIONS = [
  { key: "info", label: "行程資訊", anchor: "section-info" },
  { key: "members", label: "成員", anchor: "section-members" },
  { key: "currencies", label: "幣別匯率", anchor: "section-currencies" },
  { key: "categories", label: "分類", anchor: "section-categories" },
  { key: "payment-methods", label: "付款方式", anchor: "section-payment-methods" },
] as const;

export default function SettingsPageClient({}: { tripId: number }) {
  const { trip, reload } = useTrip();
  const router = useRouter();
  // Mobile accordion defaults to only "成員" expanded, everything else
  // (including 行程資訊) collapsed — per uiux-audit-2026-08-12.md §1.5, the
  // most-visited section on mobile is Members, not the trip-info block with
  // its initial-exchange record (and, previously, the danger zone).
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["members"]));
  const [activeAnchor, setActiveAnchor] = useState("section-info");

  // A "contributor" (guest — see backend models.TripAccess's docstring)
  // can't do ANYTHING on this page — the whole settings area is off-limits
  // per this round's "訪客也能是完整成員" simplification (訪客的存在意義只有
  // 記帳跟看結算). The backend is the real permission boundary (every write
  // here 403s for a contributor anyway), but a contributor landing on a
  // half-functional settings page by typing the URL directly reads as
  // broken, not "no access" — bounce them straight to the expenses page
  // instead, same as TripNav.tsx/BottomTabBar already hiding the "設定" tab
  // entry point entirely for this role.
  useEffect(() => {
    if (trip?.my_role === "contributor") router.replace(`/trips/${trip.id}`);
  }, [trip?.my_role, trip?.id, router]);

  if (!trip || trip.my_role === "contributor") return null;

  // "唯讀" gating — passed down to every section below so their own add/
  // edit/delete controls hide themselves for a viewer (the backend's
  // require_edit_access is the real permission boundary; this just avoids a
  // viewer clicking something that was always going to 403). See
  // lib/types.ts TripDetail.my_role's docstring.
  const readOnly = trip.my_role === "viewer";

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
      full: <TripInfoSection trip={trip} onChanged={reload} readOnly={readOnly} />,
      bare: <TripInfoSection trip={trip} onChanged={reload} readOnly={readOnly} bare />,
    },
    {
      key: "members",
      full: <PeopleSection trip={trip} onChanged={reload} />,
      bare: <PeopleSection trip={trip} onChanged={reload} bare />,
    },
    {
      key: "currencies",
      full: <CurrenciesSection trip={trip} onChanged={reload} readOnly={readOnly} />,
      bare: <CurrenciesSection trip={trip} onChanged={reload} readOnly={readOnly} bare />,
    },
    {
      key: "categories",
      full: <CategoriesSection trip={trip} onChanged={reload} readOnly={readOnly} />,
      bare: <CategoriesSection trip={trip} onChanged={reload} readOnly={readOnly} bare />,
    },
    {
      key: "payment-methods",
      full: <PaymentMethodsSection trip={trip} onChanged={reload} readOnly={readOnly} />,
      bare: <PaymentMethodsSection trip={trip} onChanged={reload} readOnly={readOnly} bare />,
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
          {sections.map((s) => (
            <div key={s.key}>{s.full}</div>
          ))}
          {/* 危險區塊 — always its own card at the very bottom of the whole
              settings page, after every other section, never inside the
              accordion collapse mechanism above (see uiux-audit-2026-08-12.md
              §1.7). */}
          {!readOnly && <DangerZoneSection trip={trip} />}
        </div>
      </div>

      {/* ===== Mobile ===== */}
      <div className="lg:hidden px-3.5 py-3.5 flex flex-col gap-2.5">
        {SECTIONS.map((s, i) => {
          const isOpen = openSections.has(s.key);
          return (
            <div key={s.key} className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <button
                onClick={() => toggleSection(s.key)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-sm font-semibold text-slate-900"
              >
                {s.label}
                <span className="text-slate-400">
                  {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                </span>
              </button>
              {isOpen && <div className="px-4 pb-4 -mt-1">{sections[i].bare}</div>}
            </div>
          );
        })}
        {!readOnly && <DangerZoneSection trip={trip} />}
      </div>
    </div>
  );
}
