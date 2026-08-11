export function CategoryChip({
  name,
  color,
  onRemove,
  compact = false,
}: {
  name: string;
  color: string;
  onRemove?: () => void;
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
      {!compact && name}
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

export function NeutralChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-600">
      {label}
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
