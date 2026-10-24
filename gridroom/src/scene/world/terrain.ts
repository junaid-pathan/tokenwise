// Pure voxel layout for the Holyoke diorama. No React, no three.
//
// A small slice of Massachusetts in blocks: Mt Tom to the north-west, the
// Connecticut River on the east with the Holyoke Dam (hydro), a mill canal,
// downtown Holyoke on a street grid, and the data center the prompts fly to.
// Deterministic for a given seed so the world is identical on every load.

export type BlockType =
  | "grass"
  | "dirt"
  | "stone"
  | "sand"
  | "water"
  | "gravel"
  | "log"
  | "leaves"
  | "planks"
  | "bricks"
  | "stonebrick"
  | "iron"
  | "glass"
  | "glow"
  | "roof"
  | "concrete"
  | "you";

export type Vec3 = [number, number, number];

export interface Label {
  text: string;
  pos: Vec3;
  kind: "poi" | "area";
}

export interface WorldLayout {
  width: number;
  depth: number;
  /** Visible blocks only (fully enclosed blocks are culled). */
  blocks: { x: number; y: number; z: number; t: BlockType }[];
  /** Spark start points: just above each home's roof. */
  homes: Vec3[];
  /** The highlighted home that real prompts (ChatGPT, panel) start from. */
  you: Vec3;
  /** Where sparks land: the data center roof. */
  dataCenter: Vec3;
  /** Base of the beacon beam on the data center roof. */
  beacon: Vec3;
  labels: Label[];
  /** Power-line polylines (post tops), hydro -> substation -> data center. */
  powerLines: Vec3[][];
}

export const WIDTH = 72;
export const DEPTH = 56;
const GROUND = 3; // flat ground height: top grass block sits at y = 2

/** Blocks light passes through; a block next to one of these is visible. */
export const SEE_THROUGH: ReadonlySet<BlockType> = new Set<BlockType>([
  "water",
  "glass",
  "leaves",
]);

// ---- seeded randomness --------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0, 1). */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// ---- map features -------------------------------------------------------------

/** River centre line (x) for a given row z. Meanders gently. */
export function riverCenter(z: number): number {
  return 56 + 2.5 * Math.sin(z / 8);
}
const RIVER_HALF = 3;
const DAM_Z = 18; // dam rows DAM_Z and DAM_Z + 1
const CANAL_Z = 24; // canal rows CANAL_Z and CANAL_Z + 1
const CANAL_X0 = 18;

export function isRiver(x: number, z: number): boolean {
  return Math.abs(x + 0.5 - riverCenter(z)) <= RIVER_HALF;
}
function riverLeft(z: number): number {
  return Math.ceil(riverCenter(z) - RIVER_HALF - 0.5);
}
function isCanal(x: number, z: number): boolean {
  return (z === CANAL_Z || z === CANAL_Z + 1) && x >= CANAL_X0 && x < riverLeft(z);
}

// Town street grid.
const ROADS_X = [19, 29, 39];
const ROADS_Z = [28, 36, 44, 52];
const TOWN = { x0: 19, x1: 47, z0: 28, z1: 53 };
function inTown(x: number, z: number): boolean {
  return x >= TOWN.x0 && x <= TOWN.x1 && z >= TOWN.z0 && z <= TOWN.z1;
}
function isRoad(x: number, z: number): boolean {
  if (inTown(x, z) && (ROADS_X.includes(x) || ROADS_Z.includes(z))) return true;
  // Bigelow St: from downtown north to the data center, over the canal.
  if (x === 29 && z >= 20 && z < TOWN.z0) return true;
  return false;
}

// Data center footprint.
const DC = { x0: 22, x1: 37, z0: 9, z1: 18, y0: GROUND, h: 5 };
function inDCApron(x: number, z: number): boolean {
  return x >= DC.x0 - 2 && x <= DC.x1 + 2 && z >= DC.z0 - 2 && z <= DC.z1 + 2;
}

// Mt Tom: a hill centred to the north-west.
function hillHeight(x: number, z: number): number {
  const d = Math.hypot(x - 6, z - 6);
  return Math.max(0, 1 - d / 24) ** 1.4 * 11;
}

/** Ground height (number of blocks) of a column, before buildings. */
export function groundHeight(x: number, z: number, seed: number): number {
  if (isRiver(x, z) || isCanal(x, z)) return 1; // bed; water sits on top
  const n = valueNoise(x / 9, z / 9, seed);
  let h = GROUND + Math.round((n - 0.5) * 1.6) + Math.round(hillHeight(x, z));
  if (inTown(x, z) || inDCApron(x, z) || isRoad(x, z)) h = GROUND;
  // Banks slope down to the river.
  const toRiver = Math.abs(x + 0.5 - riverCenter(z)) - RIVER_HALF;
  if (toRiver < 2.5) h = Math.min(h, GROUND - 1);
  return Math.max(GROUND - 1, h);
}

// ---- builder ------------------------------------------------------------------

export function buildWorld(seed = 7): WorldLayout {
  const rand = mulberry32(seed);
  const cells = new Map<string, BlockType>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const set = (x: number, y: number, z: number, t: BlockType) => cells.set(key(x, y, z), t);
  const has = (x: number, y: number, z: number) => cells.has(key(x, y, z));
  const heights: number[][] = [];
  const reserved = new Set<string>(); // columns trees must avoid
  const reserve = (x: number, z: number) => reserved.add(`${x},${z}`);

  // Terrain columns, with a stone base so the diorama has a solid edge.
  for (let x = 0; x < WIDTH; x++) {
    heights[x] = [];
    for (let z = 0; z < DEPTH; z++) {
      const h = groundHeight(x, z, seed);
      heights[x][z] = h;
      const nearWater =
        Math.abs(x + 0.5 - riverCenter(z)) - RIVER_HALF < 1.5 ||
        isCanal(x, z - 1) ||
        isCanal(x, z + 1);
      for (let y = -2; y < h; y++) {
        let t: BlockType;
        if (y === h - 1) {
          if (isRiver(x, z) || isCanal(x, z)) t = "sand";
          else if (isRoad(x, z)) t = "gravel";
          else if (h >= 11) t = "stone";
          else if (nearWater) t = "sand";
          else t = "grass";
        } else if (y >= h - 3) t = "dirt";
        else t = "stone";
        set(x, y, z, t);
      }
      // Water: the reservoir north of the dam sits one block higher.
      if (isRiver(x, z)) {
        set(x, 1, z, "water");
        if (z < DAM_Z) set(x, 2, z, "water");
        reserve(x, z);
      }
      if (isCanal(x, z)) {
        set(x, 1, z, "water");
        reserve(x, z);
      }
      if (isRoad(x, z) || inTown(x, z) || inDCApron(x, z)) reserve(x, z);
    }
  }

  // Bridges where Bigelow St crosses the canal.
  for (let z = CANAL_Z; z <= CANAL_Z + 1; z++) set(29, 2, z, "planks");

  // Holyoke Dam: a stone wall across the river, water falls past it.
  for (let x = 0; x < WIDTH; x++) {
    for (let z = DAM_Z; z <= DAM_Z + 1; z++) {
      if (!isRiver(x, z)) continue;
      for (let y = 1; y <= 3; y++) set(x, y, z, "stonebrick");
    }
  }

  // Hydro station on the west bank at the dam.
  const hx1 = riverLeft(DAM_Z) - 2;
  const hx0 = hx1 - 5;
  const hz0 = DAM_Z - 3;
  const hz1 = DAM_Z + 2;
  for (let x = hx0; x <= hx1; x++) {
    for (let z = hz0; z <= hz1; z++) {
      reserve(x, z);
      for (let y = heights[x][z]; y < GROUND + 4; y++) {
        const wall = x === hx0 || x === hx1 || z === hz0 || z === hz1;
        if (!wall && y < GROUND + 3) continue;
        const window = wall && y === GROUND + 1 && (x + z) % 2 === 0;
        set(x, y, z, window ? "glow" : y === GROUND + 3 ? "concrete" : "stonebrick");
      }
    }
  }
  const hydroTop: Vec3 = [(hx0 + hx1) / 2 + 0.5, GROUND + 5, (hz0 + hz1) / 2 + 0.5];

  // Data center: iron walls, a glass band, concrete roof, cooling units, lamps.
  const top = DC.y0 + DC.h; // roof layer
  for (let x = DC.x0; x <= DC.x1; x++) {
    for (let z = DC.z0; z <= DC.z1; z++) {
      const wall = x === DC.x0 || x === DC.x1 || z === DC.z0 || z === DC.z1;
      for (let y = DC.y0; y < top; y++) {
        if (!wall) continue;
        const band = y === DC.y0 + 2 && (x + z) % 3 !== 0;
        const pillar = (x - DC.x0) % 5 === 0 || (z - DC.z0) % 5 === 0;
        set(x, y, z, band && !pillar ? "glass" : pillar ? "concrete" : "iron");
      }
      set(x, top, z, "concrete");
      // Cooling units in a 2x2 grid of blocks along the roof.
      const ux = (x - DC.x0) % 4;
      const uz = (z - DC.z0) % 4;
      if (ux >= 1 && ux <= 2 && uz >= 1 && uz <= 2 && !(x > 27 && x < 32 && z > 11 && z < 16)) {
        set(x, top + 1, z, "iron");
      }
    }
  }
  for (const [x, z] of [
    [DC.x0, DC.z0],
    [DC.x1, DC.z0],
    [DC.x0, DC.z1],
    [DC.x1, DC.z1],
  ]) {
    set(x, top + 1, z, "glow");
  }
  const bx = Math.floor((DC.x0 + DC.x1) / 2);
  const bz = Math.floor((DC.z0 + DC.z1) / 2);
  set(bx, top + 1, bz, "iron"); // beacon base
  const beacon: Vec3 = [bx + 0.5, top + 2, bz + 0.5];
  const dataCenter: Vec3 = [bx + 0.5, top + 3, bz + 0.5];

  // Substation between the dam and the data center.
  const sx0 = 41;
  const sz0 = 11;
  for (let x = sx0; x < sx0 + 5; x++) {
    for (let z = sz0; z < sz0 + 5; z++) {
      reserve(x, z);
      set(x, heights[x][z] - 1, z, "gravel");
      if ((x - sx0) % 2 === 1 && (z - sz0) % 2 === 1) {
        set(x, heights[x][z], z, "iron");
        set(x, heights[x][z] + 1, z, "iron");
      }
    }
  }

  // Power lines on log posts: hydro -> substation -> data center.
  const postAt = (x: number, z: number): Vec3 => {
    const h = heights[x][z];
    for (let y = h; y < h + 5; y++) set(x, y, z, "log");
    reserve(x, z);
    return [x + 0.5, h + 5, z + 0.5];
  };
  const powerLines: Vec3[][] = [
    [hydroTop, postAt(hx0 - 2, DAM_Z - 4), postAt(46, 16), postAt(43, 10)],
    [postAt(41, 10), postAt(DC.x1 + 2, 10), [DC.x1 + 0.5, top + 1, 10.5]],
  ];

  // Homes on the town lots, two per block between streets.
  const homes: Vec3[] = [];
  let you: Vec3 = [0, 0, 0];
  const lotsX = [
    [20, 28],
    [30, 38],
    [40, 47],
  ];
  const lotsZ = [
    [29, 35],
    [37, 43],
    [45, 51],
  ];
  let lotIndex = 0;
  for (const [lx0, lx1] of lotsX) {
    for (const [lz0, lz1] of lotsZ) {
      const width = lx1 - lx0 + 1;
      const starts = width >= 9 ? [lx0 + 1, lx0 + 5] : [lx0 + 1];
      for (const hx of starts) {
        const isYou = lotIndex === 6 && hx === starts[0];
        const hz = lz0 + 1 + Math.floor(rand() * 2);
        const wallT: BlockType = isYou ? "you" : rand() < 0.5 ? "planks" : "bricks";
        const tall = 2 + Math.floor(rand() * 2); // 2-3 storeys of wall
        for (let x = hx; x < hx + 4; x++) {
          for (let z = hz; z < hz + 4; z++) {
            const wall = x === hx || x === hx + 3 || z === hz || z === hz + 3;
            for (let y = GROUND; y < GROUND + tall; y++) {
              if (!wall) continue;
              const win = y === GROUND + 1 && (x === hx + 1 || x === hx + 2 || z === hz + 1 || z === hz + 2);
              set(x, y, z, win ? (rand() < 0.35 ? "glow" : "glass") : wallT);
            }
            set(x, GROUND + tall, z, "roof");
            if (x === hx + 1 || x === hx + 2) set(x, GROUND + tall + 1, z, "roof");
          }
        }
        const roofTop: Vec3 = [hx + 2, GROUND + tall + 2.4, hz + 2];
        if (isYou) {
          set(hx + 1, GROUND + tall + 2, hz + 1, "glow");
          you = roofTop;
        } else homes.push(roofTop);
        // A front-yard tree on wide lots.
        if (!isYou && rand() < 0.45) growTree(hx + 4.5 < lx1 ? hx + 4 : hx - 1, hz + 3, GROUND, true);
      }
      lotIndex++;
    }
  }

  // Trees: dense on Mt Tom and across the river, sparse elsewhere.
  function growTree(x: number, z: number, ground: number, lantern: boolean) {
    if (x < 1 || z < 1 || x >= WIDTH - 1 || z >= DEPTH - 1) return;
    const trunk = 4 + Math.floor(rand() * 3);
    for (let y = ground; y < ground + trunk; y++) set(x, y, z, "log");
    const top = ground + trunk;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy >= 0 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (dy === 1 || rand() < 0.6)) continue;
          const px = x + dx;
          const pz = z + dz;
          if (px < 0 || pz < 0 || px >= WIDTH || pz >= DEPTH) continue;
          if (!has(px, top + dy, pz)) set(px, top + dy, pz, "leaves");
        }
      }
    }
    if (lantern) set(x + (rand() < 0.5 ? 1 : -1), top - 2, z, "glow");
  }
  const planted: [number, number][] = [];
  for (let x = 1; x < WIDTH - 1; x++) {
    for (let z = 1; z < DEPTH - 1; z++) {
      if (reserved.has(`${x},${z}`)) continue;
      const h = heights[x][z];
      if (h >= 11) continue; // bare summit
      const hill = hillHeight(x, z) > 1.5;
      const eastBank = x > riverCenter(z) + RIVER_HALF + 2;
      const toRiver = Math.abs(x + 0.5 - riverCenter(z)) - RIVER_HALF;
      if (toRiver < 2.5) continue;
      const p = hill ? 0.09 : eastBank ? 0.06 : 0.025;
      if (rand() > p) continue;
      if (planted.some(([px, pz]) => Math.abs(px - x) < 3 && Math.abs(pz - z) < 3)) continue;
      planted.push([x, z]);
      growTree(x, z, h, rand() < 0.12);
    }
  }

  // Cull blocks hidden on all six sides by opaque neighbours.
  const blocks: WorldLayout["blocks"] = [];
  const opaqueAt = (x: number, y: number, z: number) => {
    const t = cells.get(key(x, y, z));
    return t !== undefined && !SEE_THROUGH.has(t) && t !== "glow";
  };
  for (const [k, t] of cells) {
    const [x, y, z] = k.split(",").map(Number);
    const hidden =
      opaqueAt(x + 1, y, z) &&
      opaqueAt(x - 1, y, z) &&
      opaqueAt(x, y + 1, z) &&
      opaqueAt(x, y - 1, z) &&
      opaqueAt(x, y, z + 1) &&
      opaqueAt(x, y, z - 1);
    // Never cull the world's bottom layer edges or anything see-through.
    if (hidden && !SEE_THROUGH.has(t)) continue;
    blocks.push({ x, y, z, t });
  }

  const labels: Label[] = [
    { text: "Data center · illustrative", pos: [bx + 0.5, top + 4.5, DC.z0 - 1], kind: "poi" },
    { text: "Holyoke Dam · hydro", pos: [hydroTop[0], hydroTop[1] + 1.5, hydroTop[2]], kind: "poi" },
    { text: "Substation", pos: [sx0 + 2.5, GROUND + 4, sz0 + 2.5], kind: "poi" },
    { text: "Connecticut River", pos: [riverCenter(40) + 0.5, 3, 40], kind: "area" },
    { text: "Mt Tom", pos: [8, 12, 9], kind: "area" },
    { text: "Downtown Holyoke", pos: [33, 9, 40], kind: "area" },
  ];

  return { width: WIDTH, depth: DEPTH, blocks, homes, you, dataCenter, beacon, labels, powerLines };
}

/** Deterministic home index for a prompt id, so a prompt always starts at the same house. */
export function homeIndexFor(promptId: string, count: number): number {
  let h = 2166136261;
  for (let i = 0; i < promptId.length; i++) {
    h ^= promptId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return count > 0 ? (h >>> 0) % count : 0;
}
