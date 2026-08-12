/**
 * Frontend-only cycling color palette for trip-card top bands / dots.
 *
 * `trip.band_color` comes from the backend and is currently always the same
 * hard-coded default ("#0d9488") for every trip — see
 * backend/app/models.py's Trip.band_color column default — so today every
 * card on the home page shows an identical teal band, which defeats the
 * "glance and tell trips apart" purpose the band was designed for (see
 * uiux-audit-2026-08-12.md §1.6). Rather than touch the backend, this
 * mirrors the same cycling-by-creation-order approach already used for
 * member avatar colors (backend/app/models.py's AVATAR_COLOR_CYCLE) purely
 * on the frontend: each trip card picks its band color by index into this
 * list instead of rendering trip.band_color directly.
 */
export const TRIP_BAND_COLORS = [
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#f43f5e",
  "#0ea5e9",
  "#84cc16",
  "#f97316",
];

export function getTripBandColor(index: number): string {
  return TRIP_BAND_COLORS[index % TRIP_BAND_COLORS.length];
}
