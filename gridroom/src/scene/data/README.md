# Scene data — Massachusetts towns

## Files
- `ma-towns.json` — 351 MA municipality polygons, WGS84 (lon/lat), one property: `name` (Title Case). ~516 KB (< 1 MB). The content is a GeoJSON `FeatureCollection`; it carries a `.json` extension so Vite/TypeScript import it natively (no extra loader, no editing `vite.config.ts`).
- `town-centroids.json` — `{ "Town Name": [lon, lat] }` for all 351 towns. Area-weighted centroids computed from `ma-towns.json`, so the crowd simulator (B6) can pick towns the scene knows about.

## Attribution
Source: **MassGIS (Bureau of Geographic Information), Commonwealth of Massachusetts** — "2020 U.S. Census Towns" municipal polygons, derived by MassGIS from U.S. Census Bureau 2020 data. Copyright: *US Census Bureau, MassGIS*. Public data.

## How it was produced

1. Downloaded the polygon feature layer as GeoJSON, reprojected to WGS84 by the server (`outSR=4326`), keeping only the town-name field `TOWN20`:

```
curl "https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/Census2020_Towns/MapServer/2/query?where=1%3D1&outFields=TOWN20&outSR=4326&f=geojson&returnGeometry=true" -o ma-raw.geojson
```
(351 features, ~12 MB raw.)

2. Simplified and renamed `TOWN20` -> `name` (Title Case) with mapshaper (pinned, not added to package.json):

```
npx --yes mapshaper@0.6.100 ma-raw.geojson \
  -simplify 8% keep-shapes \
  -each "name = (TOWN20||'').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())" \
  -each "delete TOWN20" \
  -o format=geojson precision=0.0001 ma-towns.json
```
Result: 516,345 bytes (< 1 MB target).

3. Centroids computed from the simplified polygons (area-weighted; see the inline Python in the B7 PR / git history). Output written to `town-centroids.json`.

## Notes
- The GeoJSON is imported by the scene at build time (bundled by Vite); it lives inside `gridroom/` so Vite's dev server will serve it.
- Only `name` is kept — no demographic or FIPS fields — to keep the file small and the scene cheap.
