// Pure projection logic — no React, no three. Unit-testable in plain Node.
// Equirectangular projection around the Massachusetts centre with a cos(lat)
// correction for longitude, scaled so the state fits the view nicely and
// centred on the origin (so B9's camera can push in on the middle).

// Approximate geographic centre of Massachusetts (lon, lat).
export const STATE_CENTER: readonly [number, number] = [-71.8, 42.15];

// World-unit scale. MA spans ~3.6deg lon and ~1.9deg lat; this scale puts the
// state at roughly +/-11 world units wide, a comfortable size for an ortho cam.
export const PROJECTION_SCALE = 6;

/**
 * Project a lon/lat to scene X/Z (the ground plane; Y is up).
 * X grows east, Z grows south (screen-down), so the map reads north-up when
 * the camera looks down the -Z axis from the north-east.
 */
export function lonLatToXZ(lon: number, lat: number): [number, number] {
  const [clon, clat] = STATE_CENTER;
  const cosLat = Math.cos((clat * Math.PI) / 180);
  const x = (lon - clon) * cosLat * PROJECTION_SCALE;
  // Latitude increases north; we map north to -Z so the scene is north-up.
  const z = -(lat - clat) * PROJECTION_SCALE;
  return [x, z];
}
