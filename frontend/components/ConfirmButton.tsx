"use client";

import { ReactNode } from "react";

/** Destructive action wrapped with a native confirm() dialog (per design-spec 3.
 * "需二次確認（體驗層由 Developer 實作 confirm）"). */
export default function ConfirmButton({
  onConfirm,
  message,
  className = "text-rose-600 hover:text-rose-700 text-sm font-medium",
  children,
}: {
  onConfirm: () => void;
  message: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.confirm(message)) onConfirm();
      }}
    >
      {children}
    </button>
  );
}
