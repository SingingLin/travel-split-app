"use client";

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import ToastViewport, { type ToastItem } from "@/components/Toast";

type ToastType = "success" | "error";

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DISPLAY_MS = 3000;
const FADE_MS = 200; // keep in sync with Toast.tsx's transition duration

/**
 * Global toast/notification provider — wraps the whole app in
 * app/layout.tsx. Operation-result messages (add/remove member, currency,
 * category, payment method, expense, trip; the "會變成未分類" warning; a
 * mid-flow failure while creating a trip) go through `useToast().showToast()`
 * instead of an inline `{error && <p>...}` block, per design decision: those
 * are one-shot status messages, not something the user needs to keep looking
 * at to fix an input. Form-validation errors that the user must stay and
 * correct (e.g. ExpenseFormDialog's "請輸入項目名稱") intentionally stay
 * inline and do NOT go through this.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "success") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    // Start the fade-out shortly before the display window ends, then
    // actually remove it once the fade transition has had time to play.
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    }, DISPLAY_MS - FADE_MS);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DISPLAY_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
