"use client";

import { useEffect, useRef, useState } from "react";
import Card from "@/components/Card";
import { ArrowRight } from "lucide-react";
import { updateTrip } from "@/lib/api";
import { useToast } from "@/lib/ToastContext";
import type { TripDetail } from "@/lib/types";

/**
 * Trip name + base currency display. (The "危險區塊"/delete-trip card used to
 * live at the bottom of this same component — it's now its own
 * DangerZoneSection, rendered separately at the very bottom of the settings
 * page; see uiux-audit-2026-08-12.md §1.7.) Auto-saves on blur (no
 * standalone "儲存" button) so the whole 行程設定 page behaves consistently —
 * every other section here (Members/Currencies/Categories/PaymentMethods)
 * already commits each change immediately via its create/update/delete API
 * call + a toast, per earlier user feedback that a single "改完立刻生效"
 * model is easier to learn than mixing that with a section that still needs
 * an explicit save button. Mirrors PeopleSection.tsx's inline-rename pattern
 * (click-to-edit, blur/Enter commits, Escape/empty reverts).
 *
 * Start/end date fields were removed from this form (and from
 * CreateTripDialog/TripCard) per user feedback that they had no actual
 * function (no sorting/filtering/behavior ever depended on them) — the
 * backend Trip.start_date/end_date columns and API fields are intentionally
 * left in place (this project has no formal migration tooling; dropping
 * columns is unnecessary risk), they simply never get written to anymore.
 *
 * The "初始換匯紀錄" block that used to live here (one shared record for the
 * whole trip) has moved to PeopleSection.tsx, one per member — each person
 * may have exchanged a different amount at a different rate, so a single
 * trip-wide record didn't actually reflect reality. See models.Member's
 * docstring for the five initial_exchange_* fields (same shape/semantics as
 * the old Trip-level version) and models.Trip's docstring for why the old
 * Trip.initial_exchange_* columns are left in place, unused, rather than
 * dropped (this project's no-migration-tooling policy).
 */
export default function TripInfoSection({
  trip,
  onChanged,
  bare = false,
  readOnly = false,
}: {
  trip: TripDetail;
  onChanged: () => void;
  bare?: boolean;
  /** "唯讀" gating — every field here becomes disabled (trip name). See
   * SettingsPageClient.tsx / lib/types.ts TripDetail.my_role's docstring. */
  readOnly?: boolean;
}) {
  const [name, setName] = useState(trip.name);
  const [saving, setSaving] = useState(false);

  // "前往切換" for the read-only 基準幣別 field below — scrolls to
  // CurrenciesSection's card (id="section-currencies", rendered by a sibling
  // component in SettingsPageClient) and briefly highlights it, per
  // uiux-audit-2026-08-12.md §1.3/§1.4: this field used to look like a
  // clickable dropdown but silently did nothing, so switching the base
  // currency needs an explicit, working entry point. Plain DOM lookup (not a
  // ref) since CurrenciesSection isn't a child of this component — same
  // approach as SettingsPageClient's own `#section-xxx` anchor nav links. On
  // mobile, if that section's accordion happens to be collapsed the card
  // isn't mounted yet and this is a no-op; the user can still open it
  // manually from the accordion list right below.
  const goToCurrencySwitch = () => {
    const el = document.getElementById("section-currencies");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-teal-400", "ring-offset-2");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-teal-400", "ring-offset-2");
    }, 1600);
  };
  const [nameError, setNameError] = useState<string | null>(null);
  const { showToast } = useToast();
  const inputCls =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none";

  // Keep the local input synced with the trip prop when it changes from
  // outside (e.g. reload() after another section's edit) — but not while
  // the user is actively focused/typing in this field, so an unrelated
  // reload elsewhere on the page can't clobber an in-progress edit.
  const isEditingRef = useRef(false);
  useEffect(() => {
    if (!isEditingRef.current) setName(trip.name);
  }, [trip.name]);

  const commitName = async () => {
    isEditingRef.current = false;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("請輸入行程名稱");
      setName(trip.name);
      return;
    }
    if (trimmed === trip.name) {
      setName(trimmed);
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      await updateTrip(trip.id, { name: trimmed });
      onChanged();
      showToast("行程名稱已更新");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "更新行程名稱失敗", "error");
      setName(trip.name);
    } finally {
      setSaving(false);
    }
  };

  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper id="section-info">
      {!bare && <p className="text-sm md:text-base font-semibold text-slate-900 mb-3">行程資訊</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11.5px] text-slate-500 mb-1">行程名稱</label>
          <input
            className={inputCls}
            value={name}
            disabled={saving || readOnly}
            onFocus={() => {
              isEditingRef.current = true;
            }}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(trip.name);
                setNameError(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {nameError && <p className="text-xs text-rose-600 mt-1">{nameError}</p>}
        </div>
        <div>
          <label className="block text-[11.5px] text-slate-500 mb-1">基準幣別</label>
          {/* Deliberately NOT styled like an input (no border/box) — this
              value is read-only here; per uiux-audit-2026-08-12.md §1.3 the
              old bordered-box treatment made it look like a clickable
              dropdown that just silently did nothing when clicked. */}
          <div className="flex items-center gap-2 py-2">
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold bg-teal-50 text-teal-700">
              {trip.base_currency_code}
            </span>
            <button
              type="button"
              onClick={goToCurrencySwitch}
              className="text-xs text-teal-600 hover:text-teal-700 font-medium inline-flex items-center gap-0.5"
            >
              前往切換 <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
          <p className="text-[11px] text-slate-400">於下方「幣別匯率」清單切換基準幣</p>
        </div>
      </div>
    </Wrapper>
  );
}
