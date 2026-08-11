import { initials } from "@/lib/format";

const SIZE_CLASSES: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "w-4 h-4 text-[8px]",
  sm: "w-6 h-6 text-[10px]",
  md: "w-8 h-8 text-xs",
  lg: "w-10 h-10 text-sm",
};

export default function Avatar({
  name,
  color,
  size = "md",
  ringed = false,
}: {
  name: string;
  color: string;
  size?: "xs" | "sm" | "md" | "lg";
  ringed?: boolean;
}) {
  return (
    <span
      title={name}
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 ${SIZE_CLASSES[size]} ${
        ringed ? "ring-2 ring-white" : ""
      }`}
      style={{ backgroundColor: color }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({
  members,
  size = "sm",
  max = 5,
}: {
  members: { name: string; color: string }[];
  size?: "xs" | "sm" | "md" | "lg";
  max?: number;
}) {
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;
  return (
    <span className="flex -space-x-2">
      {shown.map((m, i) => (
        <Avatar key={i} name={m.name} color={m.color} size={size} ringed />
      ))}
      {overflow > 0 && (
        <span
          className={`inline-flex items-center justify-center rounded-full font-semibold text-slate-600 bg-slate-200 ring-2 ring-white shrink-0 ${SIZE_CLASSES[size]}`}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
