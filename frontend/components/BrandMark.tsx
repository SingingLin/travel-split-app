import { useId } from "react";

/**
 * TravelSplit brand mark — same artwork as app/icon.svg (teal rounded square
 * tile + a white/amber "luggage tag" glyph split down the middle, punch-hole
 * at the seam, small string loop above), inlined as a component so the two
 * header logos (app/page.tsx home header, components/TripNav.tsx desktop
 * trip header) stay pixel-identical to the browser-tab favicon instead of
 * drifting out of sync as separately hand-copied SVG blobs. v3 design — see
 * app/icon.svg's comment for why this replaced the v1 (paper airplane +
 * coin) / v2 (map pin + percent badge) directions.
 */
export default function BrandMark({ className = "w-7 h-7", rounded = "rounded-lg" }: { className?: string; rounded?: string }) {
  // Unique per instance so the clipPath id never collides if BrandMark is
  // ever rendered more than once in the same document at once (SVG ids are
  // document-global, not scoped to the <svg> they're defined in).
  const clipId = `brandmark-tag-body-${useId()}`;
  return (
    <svg
      viewBox="0 0 32 32"
      className={`${className} ${rounded} shrink-0`}
      role="img"
      aria-label="TravelSplit"
    >
      <rect width="32" height="32" rx="7" fill="#0d9488" />
      <circle cx="16" cy="7.4" r="2.4" fill="none" stroke="#ffffff" strokeWidth="1.7" />
      <line x1="16" y1="9.6" x2="16" y2="11" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />
      <clipPath id={clipId}>
        <rect x="8" y="10" width="16" height="17" rx="3.2" />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x="8" y="10" width="8" height="17" fill="#ffffff" />
        <rect x="16" y="10" width="8" height="17" fill="#f59e0b" />
      </g>
      <circle cx="16" cy="14.4" r="1.9" fill="#0d9488" />
    </svg>
  );
}
