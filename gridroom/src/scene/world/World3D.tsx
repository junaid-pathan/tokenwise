// The voxel Holyoke diorama: blocks, sky, beacon, clouds, prompt orbs, labels.
// All per-event work arrives through refs (orb queue, level, flash); React
// state here only changes at human speed.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import type { GridLevel } from "../../../../contracts/events";
import { arcControlPoint, bezierPoint } from "../arc";
import { buildMaterials } from "./textures";
import { SEE_THROUGH, type BlockType, type Vec3, type WorldLayout } from "./terrain";
import type { OrbEffect, YouPrompt } from "./worldState";

const POOL = 768;
const FLIGHT_S = 1.8;
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const SKY: Record<GridLevel, { sky: string; sun: string; sunI: number; hemiI: number }> = {
  green: { sky: "#9fd2f6", sun: "#fff3d6", sunI: 2.3, hemiI: 1.05 },
  yellow: { sky: "#f2c98f", sun: "#ffd7a1", sunI: 2.0, hemiI: 0.9 },
  red: { sky: "#d9705c", sun: "#ff9f80", sunI: 1.55, hemiI: 0.62 },
};
const BEAM: Record<GridLevel, string> = { green: "#4ade80", yellow: "#facc15", red: "#ef4444" };

// ---------------------------------------------------------------------------
function BlockMesh({
  list,
  material,
  t,
}: {
  list: WorldLayout["blocks"];
  material: THREE.Material | THREE.Material[];
  t: BlockType;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    list.forEach((b, i) => {
      o.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      o.scale.set(1, 1, 1);
      if (t === "water") {
        o.scale.y = 0.875; // water sits a little below the block top
        o.position.y -= 0.0625;
      }
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [list, t]);
  useEffect(() => () => geom.dispose(), [geom]);
  const see = SEE_THROUGH.has(t);
  return (
    <instancedMesh
      ref={ref}
      args={[geom, material, list.length]}
      castShadow={!see && t !== "glow"}
      receiveShadow={t !== "glow"}
      renderOrder={t === "water" || t === "glass" ? 2 : 0}
    />
  );
}

function Blocks({ layout }: { layout: WorldLayout }) {
  const materials = useMemo(() => buildMaterials(), []);
  const groups = useMemo(() => {
    const g = new Map<BlockType, WorldLayout["blocks"]>();
    for (const b of layout.blocks) {
      if (!g.has(b.t)) g.set(b.t, []);
      g.get(b.t)!.push(b);
    }
    return [...g.entries()];
  }, [layout]);
  return (
    <>
      {groups.map(([t, list]) => (
        <BlockMesh key={t} t={t} list={list} material={materials[t]} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
function PowerLines({ lines }: { lines: Vec3[][] }) {
  const objects = useMemo(
    () =>
      lines.map((pts) => {
        const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#1d1d1d" }));
      }),
    [lines]
  );
  useEffect(() => () => objects.forEach((o) => o.geometry.dispose()), [objects]);
  return (
    <>
      {objects.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
function Atmosphere({ levelRef }: { levelRef: React.MutableRefObject<GridLevel> }) {
  const { scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sky = useMemo(() => new THREE.Color(SKY.green.sky), []);
  useEffect(() => {
    scene.background = sky;
    scene.fog = new THREE.Fog(sky.clone(), 110, 230);
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, sky]);
  useFrame(() => {
    const p = SKY[levelRef.current];
    const k = prefersReducedMotion ? 1 : 0.04;
    sky.lerp(new THREE.Color(p.sky), k);
    (scene.fog as THREE.Fog | null)?.color.copy(sky);
    if (sun.current) {
      sun.current.color.lerp(new THREE.Color(p.sun), k);
      sun.current.intensity += (p.sunI - sun.current.intensity) * k;
    }
    if (hemi.current) hemi.current.intensity += (p.hemiI - hemi.current.intensity) * k;
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={["#cfe8ff", "#5d7f3c", 1.05]} />
      <directionalLight
        ref={sun}
        position={[40, 70, 25]}
        intensity={2.3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
        shadow-camera-far={200}
        shadow-bias={-0.0006}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
function Beacon({
  base,
  levelRef,
  flashRef,
}: {
  base: Vec3;
  levelRef: React.MutableRefObject<GridLevel>;
  flashRef: React.MutableRefObject<number>;
}) {
  const outer = useRef<THREE.MeshBasicMaterial>(null);
  const inner = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((_, dt) => {
    const target = new THREE.Color(BEAM[levelRef.current]);
    const k = prefersReducedMotion ? 1 : 0.06;
    flashRef.current = Math.max(0, flashRef.current - dt * 2.5);
    if (outer.current) {
      outer.current.color.lerp(target, k);
      outer.current.opacity = 0.22 + Math.min(flashRef.current, 1) * 0.25;
    }
    if (inner.current) inner.current.color.lerp(target, k);
  });
  const h = 70;
  return (
    <group position={[base[0], base[1] + h / 2 - 0.5, base[2]]}>
      <mesh>
        <boxGeometry args={[1.3, h, 1.3]} />
        <meshBasicMaterial
          ref={outer}
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <boxGeometry args={[0.45, h, 0.45]} />
        <meshBasicMaterial ref={inner} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
function Clouds({ width, depth }: { width: number; depth: number }) {
  const group = useRef<THREE.Group>(null);
  const clouds = useMemo(() => {
    const out: { x: number; z: number; parts: [number, number, number, number][] }[] = [];
    let s = 3;
    const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 9; i++) {
      const parts: [number, number, number, number][] = [];
      const n = 2 + Math.floor(r() * 3);
      for (let j = 0; j < n; j++) parts.push([r() * 8, 0, r() * 5, 4 + r() * 6]);
      out.push({ x: r() * (width + 40) - 20, z: r() * depth - 6, parts });
    }
    return out;
  }, [width, depth]);
  useFrame((_, dt) => {
    if (prefersReducedMotion || !group.current) return;
    group.current.children.forEach((c) => {
      c.position.x += dt * 0.7;
      if (c.position.x > width + 25) c.position.x = -25;
    });
  });
  return (
    <group ref={group}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, 30 + (i % 3) * 2, c.z]}>
          {c.parts.map(([x, y, z, w], j) => (
            <mesh key={j} position={[x, y, z]}>
              <boxGeometry args={[w, 1.2, w * 0.6]} />
              <meshLambertMaterial color="#ffffff" transparent opacity={0.92} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
interface Flight {
  active: boolean;
  start: Vec3;
  ctrl: Vec3;
  end: Vec3;
  t: number;
  size: number;
}

function Orbs({
  layout,
  queueRef,
  flashRef,
  clearRef,
}: {
  layout: WorldLayout;
  queueRef: React.MutableRefObject<OrbEffect[]>;
  flashRef: React.MutableRefObject<number>;
  clearRef: React.MutableRefObject<boolean>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const o = useMemo(() => new THREE.Object3D(), []);
  const flights = useMemo<Flight[]>(
    () =>
      Array.from({ length: POOL }, () => ({
        active: false,
        start: [0, 0, 0] as Vec3,
        ctrl: [0, 0, 0] as Vec3,
        end: [0, 0, 0] as Vec3,
        t: 0,
        size: 0.32,
      })),
    []
  );
  const cursor = useRef(0);
  const color = useMemo(() => new THREE.Color(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    o.position.set(0, -999, 0);
    o.scale.setScalar(0);
    o.updateMatrix();
    for (let i = 0; i < POOL; i++) {
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, color.set("#000000"));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [o, color]);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    if (clearRef.current) {
      clearRef.current = false;
      queueRef.current.length = 0;
      flights.forEach((f) => (f.active = false));
    }
    const q = queueRef.current;
    while (q.length) {
      const item = q.shift()!;
      const start = item.you ? layout.you : layout.homes[item.home] ?? layout.you;
      const i = cursor.current;
      cursor.current = (cursor.current + 1) % POOL;
      const f = flights[i];
      f.active = true;
      f.start = start;
      f.end = layout.dataCenter;
      f.ctrl = arcControlPoint(start, layout.dataCenter, 0.35);
      f.t = prefersReducedMotion ? 0.94 : 0;
      f.size = item.you ? 0.95 : 0.46;
      mesh.setColorAt(i, color.set(item.color));
    }
    let any = false;
    for (let i = 0; i < POOL; i++) {
      const f = flights[i];
      if (!f.active) continue;
      any = true;
      f.t += dt / FLIGHT_S;
      if (f.t >= 1) {
        f.active = false;
        flashRef.current = Math.min(1.5, flashRef.current + (f.size > 0.5 ? 1 : 0.08));
        o.position.set(0, -999, 0);
        o.scale.setScalar(0);
      } else {
        const p = bezierPoint(f.start, f.ctrl, f.end, f.t);
        o.position.set(p[0], p[1], p[2]);
        o.rotation.set(f.t * 6, f.t * 4, 0);
        o.scale.setScalar(f.size * (0.6 + 0.4 * Math.sin(Math.PI * f.t)));
      }
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    }
    if (any) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, POOL]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
function CameraRig({ levelRef, resetRef }: { levelRef: React.MutableRefObject<GridLevel>; resetRef: React.MutableRefObject<boolean> }) {
  const { camera } = useThree();
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const target = levelRef.current === "red" ? 1.35 : 1;
    if (resetRef.current) {
      resetRef.current = false;
      cam.zoom = 1;
      cam.updateProjectionMatrix();
    }
    const next = prefersReducedMotion ? target : cam.zoom + (target - cam.zoom) * 0.03;
    if (Math.abs(next - cam.zoom) > 0.0005) {
      cam.zoom = next;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

// ---------------------------------------------------------------------------
function Labels({ layout, you, site }: { layout: WorldLayout; you: YouPrompt | null; site: string }) {
  const recent = you && Date.now() - you.at < 9000 ? you : null;
  return (
    <>
      {layout.labels.map((l) => (
        <Html key={l.text} position={l.pos} center zIndexRange={[5, 0]}>
          <div className={`w-tag ${l.kind}`}>{l.text}</div>
        </Html>
      ))}
      <Html position={[layout.you[0], layout.you[1] + 1.6, layout.you[2]]} center zIndexRange={[6, 0]}>
        <div className={`w-tag you${recent ? " hot" : ""}`}>
          <b>YOU · {site}</b>
          {recent && (
            <span>
              {recent.deferred
                ? ` · queued (Gear ${recent.gearNeeded})`
                : recent.gearUsed < recent.gearNeeded
                  ? ` · Gear ${recent.gearNeeded} → ${recent.gearUsed}`
                  : ` · Gear ${recent.gearUsed}`}
            </span>
          )}
        </div>
      </Html>
    </>
  );
}

// ---------------------------------------------------------------------------
export default function World3D({
  layout,
  levelRef,
  queueRef,
  flashRef,
  clearRef,
  resetCamRef,
  you,
}: {
  layout: WorldLayout;
  levelRef: React.MutableRefObject<GridLevel>;
  queueRef: React.MutableRefObject<OrbEffect[]>;
  flashRef: React.MutableRefObject<number>;
  clearRef: React.MutableRefObject<boolean>;
  resetCamRef: React.MutableRefObject<boolean>;
  you: YouPrompt | null;
}) {
  const half: Vec3 = [-layout.width / 2, 0, -layout.depth / 2];
  return (
    <Canvas shadows dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <PerspectiveCamera makeDefault position={[54, 60, 76]} fov={34} near={1} far={400} />
      <OrbitControls
        target={[1, 0, 1]}
        enableDamping
        dampingFactor={0.08}
        minDistance={30}
        maxDistance={150}
        maxPolarAngle={1.2}
      />
      <CameraRig levelRef={levelRef} resetRef={resetCamRef} />
      <Atmosphere levelRef={levelRef} />
      <group position={half}>
        <Blocks layout={layout} />
        <PowerLines lines={layout.powerLines} />
        <Beacon base={layout.beacon} levelRef={levelRef} flashRef={flashRef} />
        <Orbs layout={layout} queueRef={queueRef} flashRef={flashRef} clearRef={clearRef} />
        <Clouds width={layout.width} depth={layout.depth} />
        <Labels layout={layout} you={you} site={you?.site ?? "Claude"} />
      </group>
      <EffectComposer>
        <Bloom intensity={0.75} luminanceThreshold={0.82} luminanceSmoothing={0.15} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
