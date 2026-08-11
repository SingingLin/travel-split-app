"use client";

import { ReactNode, useEffect } from "react";

/**
 * Responsive form dialog: renders as a centered Modal on desktop (lg:+) and
 * a bottom sheet on mobile — one component, CSS handles the layout switch,
 * per design-spec.md 3. "Modal" / "Bottom Sheet" (same underlying content).
 */
export default function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-end lg:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full lg:max-w-2xl bg-white rounded-t-2xl lg:rounded-xl shadow-lg max-h-[90vh] lg:max-h-[88vh] overflow-y-auto p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-9 h-1 rounded-full bg-slate-300 mx-auto mb-4 lg:hidden" />
        <p className="text-base lg:text-lg font-bold text-slate-900 mb-0.5">{title}</p>
        {subtitle && <p className="text-xs text-slate-500 mb-4">{subtitle}</p>}
        {!subtitle && <div className="mb-2" />}
        {children}
      </div>
    </div>
  );
}
