// Procedural 16x16 pixel-art block textures, drawn on canvases at startup.
// Nearest-neighbour filtering keeps the crisp blocky look. No image assets.
import * as THREE from "three";
import { mulberry32, type BlockType } from "./terrain";

const S = 16;

type Painter = (px: (x: number, y: number, c: string) => void, r: () => number) => void;

function speckle(colors: string[]): Painter {
  return (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) px(x, y, colors[Math.floor(r() * colors.length)]);
  };
}

const DIRT = ["#86592f", "#79502a", "#94653a", "#6b4523", "#8d6036"];
const GRASS = ["#5ea73a", "#6bb544", "#4e922f", "#77bf4d", "#62ad3d"];

const PAINTERS: Record<string, Painter> = {
  grass_top: speckle(GRASS),
  grass_side: (px, r) => {
    speckle(DIRT)(px, r);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(r() * 3);
      for (let y = 0; y < depth; y++) px(x, y, GRASS[Math.floor(r() * GRASS.length)]);
    }
  },
  dirt: speckle(DIRT),
  stone: speckle(["#7d7d7d", "#888888", "#6f6f6f", "#949494", "#808080"]),
  sand: speckle(["#dcd3a1", "#e4dcae", "#cfc68f", "#d8cf98"]),
  gravel: speckle(["#857f7c", "#6c6765", "#9b9592", "#7a7472", "#5f5a58"]),
  water: speckle(["#2f62c9", "#3a70d9", "#2956b8", "#3468cf"]),
  log_side: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const stripe = x % 4 === 0 ? "#4f3a22" : x % 4 === 2 ? "#6d5233" : "#5f4729";
        px(x, y, r() < 0.12 ? "#3f2e1b" : stripe);
      }
  },
  log_top: (px) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        px(x, y, d > 6.5 ? "#5f4729" : Math.floor(d) % 2 ? "#a88452" : "#bd9a63");
      }
  },
  leaves: (px, r) => {
    const c = ["#2f7d22", "#3c9a2a", "#26681c", "#45a632"];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) px(x, y, r() < 0.14 ? "rgba(0,0,0,0)" : c[Math.floor(r() * c.length)]);
  },
  planks: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const seam = y % 4 === 3 || (x === ((Math.floor(y / 4) * 7) % S) && y % 4 !== 3);
        px(x, y, seam ? "#7a5a34" : r() < 0.5 ? "#b89461" : "#a98654");
      }
  },
  bricks: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = Math.floor(y / 4);
        const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
        px(x, y, mortar ? "#b9ada3" : r() < 0.5 ? "#9b4a39" : "#8a3f31");
      }
  },
  stonebrick: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = Math.floor(y / 8);
        const seam = y % 8 === 7 || (x + row * 8) % 16 === 15;
        px(x, y, seam ? "#545454" : r() < 0.5 ? "#7b7b7b" : "#868686");
      }
  },
  iron: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
        px(x, y, edge ? "#a9a9a9" : r() < 0.5 ? "#dedede" : "#d2d2d2");
      }
  },
  concrete: speckle(["#e6e6e3", "#e0e0dc", "#ebebe8"]),
  glass: (px) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
        const glint = x - y === 4 || x - y === 6;
        px(x, y, edge ? "#dceaf2" : glint ? "rgba(255,255,255,0.7)" : "rgba(170,215,240,0.28)");
      }
  },
  glow: (px, r) => {
    const c = ["#ffd56b", "#ffe9a6", "#f3b748", "#ffcc55"];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, c[Math.floor(r() * c.length)]);
  },
  roof: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) px(x, y, y % 4 === 3 ? "#2c1d12" : r() < 0.5 ? "#4a3220" : "#3f2a1b");
  },
  you: (px, r) => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
        px(x, y, edge ? "#1f6fb2" : r() < 0.5 ? "#4aa3e8" : "#3d94db");
      }
  },
};

function makeTexture(name: string, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const r = mulberry32(seed);
  PAINTERS[name]((x, y, c) => {
    ctx.fillStyle = c;
    ctx.clearRect(x, y, 1, 1);
    ctx.fillRect(x, y, 1, 1);
  }, r);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** One material (or a six-face array) per block type. Build once and reuse. */
export function buildMaterials(): Record<BlockType, THREE.Material | THREE.Material[]> {
  const tex: Record<string, THREE.CanvasTexture> = {};
  Object.keys(PAINTERS).forEach((name, i) => (tex[name] = makeTexture(name, 101 + i * 17)));
  const lambert = (name: string, extra: THREE.MeshLambertMaterialParameters = {}) =>
    new THREE.MeshLambertMaterial({ map: tex[name], ...extra });

  const grassSide = lambert("grass_side");
  const grassTop = lambert("grass_top");
  const dirt = lambert("dirt");
  const logSide = lambert("log_side");
  const logTop = lambert("log_top");

  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  return {
    grass: [grassSide, grassSide, grassTop, dirt, grassSide, grassSide],
    dirt,
    stone: lambert("stone"),
    sand: lambert("sand"),
    water: lambert("water", { transparent: true, opacity: 0.78, depthWrite: false }),
    gravel: lambert("gravel"),
    log: [logSide, logSide, logTop, logTop, logSide, logSide],
    leaves: lambert("leaves", { alphaTest: 0.5, side: THREE.DoubleSide }),
    planks: lambert("planks"),
    bricks: lambert("bricks"),
    stonebrick: lambert("stonebrick"),
    iron: lambert("iron"),
    glass: lambert("glass", { transparent: true, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ map: tex.glow, toneMapped: false }),
    roof: lambert("roof"),
    concrete: lambert("concrete"),
    you: lambert("you", { emissive: new THREE.Color("#0b2c4a"), emissiveIntensity: 0.6 }),
  };
}
