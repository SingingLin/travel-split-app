export function CategoryChip({
  name,
  color,
  onRemove,
  onNameClick,
  compact = false,
}: {
  name: string;
  color: string;
  onRemove?: () => void;
  /** When provided, the name renders as a button (settings pages' inline-edit
   * entry point) instead of plain text. Not used by read-only usages (e.g.
   * ExpensesPageClient's list rows). */
  onNameClick?: () => void;
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      style={{ backgroundColor: `${color}1a`, color }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {!compact &&
        (onNameClick ? (
          <button type="button" onClick={onNameClick} className="hover:underline" title="點擊編輯名稱">
            {name}
          </button>
        ) : (
          name
        ))}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100"
          aria-label={`移除 ${name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function NeutralChip({
  label,
  onRemove,
  onNameClick,
}: {
  label: string;
  onRemove?: () => void;
  /** See CategoryChip's onNameClick doc. */
  onNameClick?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-600">
      {onNameClick ? (
        <button type="button" onClick={onNameClick} className="hover:underline" title="點擊編輯名稱">
          {label}
        </button>
      ) : (
        label
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100"
          aria-label={`移除 ${label}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function SplitStatusBadge({
  needsSplit,
  participantCount,
  allSettled,
}: {
  needsSplit: boolean;
  participantCount: number;
  allSettled: boolean;
}) {
  if (!needsSplit) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-600 whitespace-nowrap">
        個人
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
        allSettled ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
      }`}
    >
      分攤 {participantCount} 人・{allSettled ? "已結清" : "待結清"}
    </span>
  );
}

/** Small "收入" pill shown next to income-type expense rows/cards so they're
 * visually distinguishable from regular (expense-type) entries at a glance
 * — pairs with the green "+" prefix formatMoney/formatSignedMoney callers
 * already apply to an income row's amount (see ExpensesPageClient.tsx).
 * Renders nothing for type="expense" (the common case) so callers can use it
 * unconditionally without an extra `needsSplit`-style guard. */
export function ExpenseTypeBadge({ type, compact = false }: { type: "expense" | "income"; compact?: boolean }) {
  if (type !== "income") return null;
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold bg-emerald-50 text-emerald-600 whitespace-nowrap ${
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      收入
    </span>
  );
}

export function TripStatusBadge({ status }: { status: string }) {
  const isActive = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
        isActive ? "bg-sky-50 text-sky-600" : "bg-slate-100 text-slate-500"
      }`}
    >
      {isActive ? "進行中" : "已結算"}
    </span>
  );
}
