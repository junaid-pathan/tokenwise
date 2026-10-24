// Builds ONE merged BufferGeometry for all ~351 Massachusetts town tiles, so
// the whole ground is a single draw call. Each town is a low extruded prism;
// per-vertex colour lets us tint the floor cheaply. Imports three (not covered
// by the plain-Node unit tests — the pure math lives in projection.ts).
import * as THREE from "three";
import { lonLatToXZ } from "./projection.ts";

export interface TownFeature {
  type: "Feature";
  properties: { name: string };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}
export interface TownCollection {
  type: "FeatureCollection";
  features: TownFeature[];
}

const TILE_DEPTH = 0.18; // extrusion height — low, so it reads as a floor

function ringToShape(ring: number[][]): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    const [x, z] = lonLatToXZ(lon, lat);
    // We build the shape in XY then lay it flat; keep X=x, Y=-z so after the
    // rotation the map is north-up.
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  return shape;
}

function polygonToShapes(coords: number[][][]): THREE.Shape {
  const shape = ringToShape(coords[0]);
  for (let h = 1; h < coords.length; h++) {
    shape.holes.push(new THREE.Path(ringToShape(coords[h]).getPoints()));
  }
  return shape;
}

/**
 * Build the merged ground geometry. Returns the geometry plus a per-town
 * vertex-range table so a future caller could tint individual towns; here the
 * whole floor shares one colour that we set via the material/vertex colours.
 */
export function buildGroundGeometry(data: TownCollection): THREE.BufferGeometry {
  const geoms: THREE.BufferGeometry[] = [];
  const extrude = { depth: TILE_DEPTH, bevelEnabled: false, steps: 1 };

  for (const f of data.features) {
    const polys: number[][][][] =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    for (const poly of polys) {
      const shape = polygonToShapes(poly);
      const g = new THREE.ExtrudeGeometry(shape, extrude);
      geoms.push(g);
    }
  }

  const merged = mergeGeometries(geoms);
  for (const g of geoms) g.dispose();

  // Lay flat: the shapes were built in XY, extruded along +Z. Rotate so the
  // map lies on the XZ ground plane with tiles standing up a little in +Y.
  merged.rotateX(-Math.PI / 2);
  merged.computeVertexNormals();

  // Add a per-vertex colour attribute (neutral white so the material colour
  // the Scene lerps toward is NOT halved — a 0.5 grey here multiplied the red
  // tint down into a dull olive). The Scene drives the tint via material.color.
  const count = merged.getAttribute("position").count;
  const colors = new Float32Array(count * 3).fill(1.0);
  merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return merged;
}

// Minimal geometry merge (positions + normals) without pulling in three's
// examples/ BufferGeometryUtils (keeps the import graph simple for Vite).
function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of geoms) total += g.getAttribute("position").count;
  const positions = new Float32Array(total * 3);
  let offset = 0;
  for (const g of geoms) {
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    positions.set(pos.array as Float32Array, offset);
    offset += pos.array.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return merged;
}
