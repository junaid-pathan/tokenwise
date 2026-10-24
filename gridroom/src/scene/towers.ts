// Pure tower definitions and nearest-tower logic. No React, no three.
import { lonLatToXZ } from "./projection.ts";

export interface Tower {
  name: string;
  label: string;
  lon: number;
  lat: number;
}

// Three illustrative data-center towers. Coords are (lat, lon) in the PRD;
// stored here as explicit lon/lat.
export const TOWERS: readonly Tower[] = [
  { name: "Holyoke", label: "Holyoke (illustrative)", lat: 42.2043, lon: -72.6162 },
  { name: "Westfield", label: "Westfield (illustrative)", lat: 42.1251, lon: -72.7495 },
  { name: "Lowell", label: "Lowell (illustrative)", lat: 42.6334, lon: -71.3162 },
];

/**
 * Index of the tower nearest to the given lon/lat, measured in projected
 * scene space (so it matches what the user sees). Returns 0 if no towers.
 */
export function nearestTowerIndex(lon: number, lat: number): number {
  const [px, pz] = lonLatToXZ(lon, lat);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < TOWERS.length; i++) {
    const [tx, tz] = lonLatToXZ(TOWERS[i].lon, TOWERS[i].lat);
    const dx = tx - px;
    const dz = tz - pz;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
