"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** Rendered instead of `label` inside the closed button once this option
   * is selected — falls back to `label` when omitted. Lets a caller show a
   * richer/longer string in the open list but a shorter one once picked
   * (mirrors how a couple of this app's native <select>s used to rely on
   * the browser's own closed-vs-open rendering difference, which a custom
   * dropdown doesn't get for free). */
  shortLabel?: ReactNode;
  disabled?: boolean;
}

/**
 * Shared custom dropdown, replacing every plain `<select>` across this app
 * (see uiux task spec — native selects render with the OS's own popup
 * chrome, which looks visually inconsistent with every other bordered/
 * rounded input in this app). Deliberately kept close to a native
 * `<select>`'s calling convention (value/onChange(string)/options) so
 * swapping a call site is close to a drop-in replacement.
 *
 * Behavior: click the button to open a floating option list right below it;
 * click anywhere outside, press Escape, or pick an option to close it again.
 * Not a full ARIA combobox implementation (no roving-tabindex arrow-key
 * navigation) — this app's native selects didn't have custom keyboard
 * navigation either beyond the browser's own type-ahead, so this keeps
 * parity rather than under- or over-building; every option is still a real
 * <button> so Tab/Enter/Space and screen readers work.
 *
 * The open option list is rendered through a `createPortal` into
 * `document.body` at a `position: fixed` spot computed from the trigger
 * button's `getBoundingClientRect()`, instead of being a plain `absolute`
 * child positioned relative to this component's own wrapper. Every call
 * site that opens inside `Dialog.tsx` sits in that dialog's scrollable card
 * (`overflow-y-auto` + `max-h-[..vh]`, see Dialog.tsx) — a same-DOM-subtree
 * `absolute` list is clipped to (or visually broken by) that ancestor's
 * overflow box the moment the list would extend past it, which is exactly
 * the "幣別 dropdown spills out of the 建立新行程 dialog" bug this was
 * built to fix. Portaling to `<body>` removes the list from that clipping
 * ancestor entirely; position is recalculated on open and kept in sync via
 * scroll (capture-phase, so it also fires for the Dialog card's own scroll
 * container, not just the window)/resize listeners while open, and flips
 * above the trigger when there isn't enough room below it in the viewport.
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = "請選擇…",
  disabled = false,
  className = "",
  buttonClassName = "",
  name,
  size = "md",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Extra classes on the outer wrapper (positioning context). */
  className?: string;
  /** Extra classes on the trigger button, appended after the default
   * input-like styling — use this for width overrides etc. */
  buttonClassName?: string;
  name?: string;
  /** "md" = normal form-field sizing (matches this app's `inputCls`); "sm"
   * = compact, for inline table/filter-bar usage (matches this app's
   * `desktopFilterInputCls`/pill-style selects). */
  size?: "md" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    openUp: boolean;
  } | null>(null);

  // Portal target must only be touched client-side (no `document` at SSR
  // time) — this is the standard "flip a mounted flag once hydrated" guard
  // for a client-only createPortal target, not state genuinely derived from
  // an external system, so the cascading-render lint concern doesn't apply
  // (it fires exactly once, ever, per mount).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-mount flag for the createPortal target, see comment above
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = rootRef.current && rootRef.current.contains(target);
      const insideList = listRef.current && listRef.current.contains(target);
      if (!insideTrigger && !insideList) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Compute (and keep in sync) the floating list's viewport-relative
  // position from the trigger button's real on-screen rect — see the
  // component doc comment above for why this can't just be a plain
  // `absolute` child anymore.
  useLayoutEffect(() => {
    if (!open) return;
    const GAP = 4;
    const MIN_HEIGHT = 120;
    const PREFERRED_MAX_HEIGHT = 256; // matches the old max-h-64
    const updatePosition = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - GAP;
      const spaceAbove = rect.top - GAP;
      const openUp = spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow;
      const available = openUp ? spaceAbove : spaceBelow;
      setPos({
        top: openUp ? rect.top - GAP : rect.bottom + GAP,
        left: rect.left,
        // Always exactly the trigger button's own width — matches a native
        // <select>'s popup, and keeps the open list visually aligned with
        // its trigger. Previously this grew up to whatever space was left
        // to the viewport edge to fit a longer option label, which made the
        // list look wildly wider than its trigger (e.g. a short currency
        // button opening into a list nearly as wide as the whole dialog).
        // A long option label no longer widens the list — it truncates
        // with an ellipsis instead (see the option `<button>`'s `truncate`
        // class below), same as the closed trigger button already does.
        // Since the list can never be wider than its on-screen trigger, it
        // also can't run off the right edge of the viewport the way an
        // uncapped `min-w-max` used to (the pre-portal styling bug).
        width: rect.width,
        maxHeight: Math.max(MIN_HEIGHT, Math.min(PREFERRED_MAX_HEIGHT, available)),
        openUp,
      });
    };
    updatePosition();
    // `capture: true` so this also fires for scroll events on the Dialog
    // card's own `overflow-y-auto` container (and any other scrollable
    // ancestor), not just the window itself.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  const sizeCls =
    size === "sm"
      ? "px-2.5 py-1.5 text-xs"
      : "px-3 py-2 text-sm";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        name={name}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-1.5 border border-slate-300 rounded-lg bg-white text-left focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none disabled:opacity-50 disabled:cursor-not-allowed ${sizeCls} ${buttonClassName}`}
      >
        <span className={`truncate ${selected ? "text-slate-800" : "text-slate-400"}`}>
          {selected ? (selected.shortLabel ?? selected.label) : placeholder}
        </span>
        <ChevronDown size={14} className="text-slate-400 shrink-0" aria-hidden="true" />
      </button>
      {open &&
        mounted &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              transform: pos.openUp ? "translateY(-100%)" : undefined,
            }}
            className="z-[999] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                disabled={o.disabled}
                onClick={() => {
                  if (o.disabled) return;
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm truncate disabled:opacity-40 disabled:cursor-not-allowed ${
                  o.value === value ? "bg-teal-50 text-teal-700 font-medium" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {o.label}
              </button>
            ))}
            {options.length === 0 && <p className="px-3 py-1.5 text-sm text-slate-400">沒有選項</p>}
          </div>,
          document.body
        )}
    </div>
  );
}
