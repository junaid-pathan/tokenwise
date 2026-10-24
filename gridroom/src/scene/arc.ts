// Pure quadratic-bezier arc math for the traffic sparks. No React, no three.
// A spark travels from a town (on the ground) to a tower, arched upward.

export type Vec3 = [number, number, number];

/**
 * Quadratic bezier control point: midway between start and end, lifted up by
 * `arch` on the Y axis so the spark arcs over the map. `arch` scales with the
 * horizontal distance so short hops arc less than long ones.
 */
export function arcControlPoint(start: Vec3, end: Vec3, archScale = 0.45): Vec3 {
  const mx = (start[0] + end[0]) / 2;
  const mz = (start[2] + end[2]) / 2;
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const dist = Math.hypot(dx, dz);
  const my = Math.max(start[1], end[1]) + dist * archScale + 1.0;
  return [mx, my, mz];
}

/** Point on the quadratic bezier at t in [0,1]. */
export function bezierPoint(start: Vec3, ctrl: Vec3, end: Vec3, t: number): Vec3 {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  return [
    a * start[0] + b * ctrl[0] + c * end[0],
    a * start[1] + b * ctrl[1] + c * end[1],
    a * start[2] + b * ctrl[2] + c * end[2],
  ];
}

/** Duration of one spark flight, in seconds. */
export const SPARK_DURATION = 1.2;
