"use client";

import { ReactNode } from "react";

/** Destructive action wrapped with a native confirm() dialog (per design-spec 3.
 * "需二次確認（體驗層由 Developer 實作 confirm）"). */
export default function ConfirmButton({
  onConfirm,
  message,
  className = "text-rose-600 hover:text-rose-700 text-sm font-medium",
  children,
  disabled = false,
  title,
}: {
  onConfirm: () => void;
  message: string;
  className?: string;
  children: ReactNode;
  /** When true, renders as a disabled button and never opens the confirm()
   * dialog — for actions that are structurally impossible right now (e.g.
   * PeopleSection.tsx's owner-can't-remove-own-access row) rather than
   * something the user should discover only after clicking and getting an
   * error back from the server. */
  disabled?: boolean;
  /** Tooltip shown on hover — most useful paired with `disabled` to explain
   * *why* the action is unavailable. */
  title?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (!disabled && window.confirm(message)) onConfirm();
      }}
    >
      {children}
    </button>
  );
}
