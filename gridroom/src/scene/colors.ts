// Pure colour logic. Hard-coded hex (we do NOT import gears.json at runtime:
// Vite's dev server refuses files outside gridroom/). No React, no three.
import type { GridLevel } from "../../../contracts/events.ts";

// Floor-tint colours per grid level.
export const LEVEL_COLORS: Record<GridLevel, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
};

// Two signal colours only, for the traffic sparks.
export const SPARK_AMBER = "#f59e0b"; // full power: gear_used >= gear_needed
export const SPARK_GREEN = "#22c55e"; // downshifted: gear_used < gear_needed

export function levelColor(level: GridLevel): string {
  return LEVEL_COLORS[level];
}

/**
 * Spark colour rule. Amber when the route ran at full power
 * (gear_used >= gear_needed), green when it was downshifted.
 */
export function sparkColor(gearUsed: number, gearNeeded: number): string {
  return gearUsed >= gearNeeded ? SPARK_AMBER : SPARK_GREEN;
}

/** Parse a "#rrggbb" string to normalised [r,g,b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
