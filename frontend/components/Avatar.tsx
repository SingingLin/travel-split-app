"use client";

import { useState } from "react";
import { initials } from "@/lib/format";

const SIZE_CLASSES: Record<"xs" | "sm" | "md" | "lg", string> = {
  xs: "w-4 h-4 text-[8px]",
  sm: "w-6 h-6 text-[10px]",
  md: "w-8 h-8 text-xs",
  lg: "w-10 h-10 text-sm",
};

/**
 * Shared member/user avatar: shows a real Google profile photo when one is
 * available, falling back to the original initials-on-a-color-chip look
 * otherwise — the color chip is still the ONLY look for a guest or an
 * unlinked split-only member, since `avatarUrl` is only ever populated
 * server-side for a linked, non-Google-guest User with a stored Google
 * avatar (see backend/app/models.py Member.avatar_url / schemas.
 * TripAccessUserOut.avatar_url — never re-derived here from e.g. checking
 * user_id alone).
 *
 * `onError` falls back to the color chip for THIS render if the image URL
 * ever fails to load (stale/expired Google CDN link, offline, etc.) instead
 * of leaving a broken-image icon — the once-failed state resets naturally
 * the next time this component mounts with a (possibly different) avatarUrl.
 */
export default function Avatar({
  name,
  color,
  avatarUrl,
  size = "md",
  ringed = false,
}: {
  name: string;
  color: string;
  /** Google profile photo URL — omit/null to always show the initials/color
   * chip (e.g. for a guest or an unlinked member). */
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  ringed?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!avatarUrl && !imgFailed;

  return (
    <span
      title={name}
      className={`inline-flex items-center justify-center overflow-hidden rounded-full font-semibold text-white shrink-0 ${SIZE_CLASSES[size]} ${
        ringed ? "ring-2 ring-white" : ""
      }`}
      style={showImage ? undefined : { backgroundColor: color }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- external Google-hosted avatar, not a Next-optimizable static asset
        <img
          src={avatarUrl!}
          alt={name}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function AvatarStack({
  members,
  size = "sm",
  max = 5,
}: {
  members: { name: string; color: string; avatar_url?: string | null }[];
  size?: "xs" | "sm" | "md" | "lg";
  max?: number;
}) {
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;
  return (
    <span className="flex -space-x-2">
      {shown.map((m, i) => (
        <Avatar key={i} name={m.name} color={m.color} avatarUrl={m.avatar_url} size={size} ringed />
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
