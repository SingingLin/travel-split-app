"use client";

export interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error";
  /** True for the final ~250ms before removal — ToastContext flips this
   * shortly before actually removing the item so the fade-out transition
   * below has something to animate to. */
  leaving?: boolean;
}

/**
 * Fixed-position stack of auto-dismissing notification pills (top-right,
 * per design-spec 3.'s "一般提示訊息" info tone / rose for errors). Purely
 * presentational — ToastContext owns the 3000ms timers, this just renders
 * whatever's currently in the list and fades each item in/out via the
 * `leaving` flag. Clicking a toast dismisses it immediately.
 */
export default function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => onDismiss(t.id)}
          className={`cursor-pointer rounded-lg shadow-lg border px-4 py-3 text-sm font-medium leading-snug transition-all duration-200 ease-out ${
            t.leaving ? "opacity-0 -translate-y-1.5" : "opacity-100 translate-y-0"
          } ${t.type === "error" ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-teal-600 border-teal-700 text-white"}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
