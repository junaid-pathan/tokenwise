// B (PR B7): the 3D Grid Room scene.
//
// Contract (do NOT change the signature — App.tsx depends on it):
//   export default function Scene({ events }: { events: DownshiftEvent[] })
// `events` is the most recent <=200 bus events in arrival order. We process
// each event exactly once (dedup by id in EventProcessor) and do all per-event
// work in refs / useFrame, never in React render, so a fast stream never
// rebuilds the scene.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import type { DownshiftEvent, GridLevel } from "../../../contracts/events";
import { EventProcessor, type Effect } from "./effects";
import { buildGroundGeometry, type TownCollection } from "./groundGeometry";
import { lonLatToXZ } from "./projection";
import { TOWERS, nearestTowerIndex } from "./towers";
import { hexToRgb, levelColor } from "./colors";
import { arcControlPoint, bezierPoint, SPARK_DURATION, type Vec3 } from "./arc";
import townData from "./data/ma-towns.json";
import centroidsJson from "./data/town-centroids.json";

const CENTROIDS = centroidsJson as unknown as Record<string, [number, number]>;

const POOL = 512; // spark instances (ring buffer)
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Ground: one merged geometry, vertex colours lerp toward the level tint.
// ---------------------------------------------------------------------------
function Ground({ levelRef }: { levelRef: React.MutableRefObject<GridLevel> }) {
  const geom = useMemo(
    () => buildGroundGeometry(townData as unknown as TownCollection),
    []
  );
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const current = useRef(new THREE.Color("#0b1220"));

  useEffect(() => () => geom.dispose(), [geom]);

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    // Keep tiles dark and readable: tint is a dim version of the level colour.
    const [r, g, b] = hexToRgb(levelColor(levelRef.current));
    const target = new THREE.Color(r, g, b).multiplyScalar(0.32).addScalar(0.03);
    current.current.lerp(target, 0.06);
    mat.color.copy(current.current);
  });

  return (
    <mesh geometry={geom} castShadow receiveShadow>
      <meshStandardMaterial
        ref={matRef}
        vertexColors
        roughness={0.85}
        metalness={0.05}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Towers: three glowing prisms with labels; glow/height follow live watts.
// ---------------------------------------------------------------------------
function Towers({ wattsRef }: { wattsRef: React.MutableRefObject<number> }) {
  const groupRefs = useRef<(THREE.Mesh | null)[]>([]);
  const matRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const smoothed = useRef(55); // idle glow baseline (W)

  useFrame(() => {
    // Smooth the watts (exponential). 40..90 W -> normalised 0..1.
    smoothed.current += (wattsRef.current - smoothed.current) * 0.05;
    const norm = THREE.MathUtils.clamp((smoothed.current - 35) / 60, 0, 1);
    for (let i = 0; i < TOWERS.length; i++) {
      const mesh = groupRefs.current[i];
      const mat = matRefs.current[i];
      if (mat) mat.emissiveIntensity = 0.6 + norm * 2.2;
      if (mesh && !prefersReducedMotion) {
        // Height pulse (scale Y). Disabled under reduced motion.
        const h = 1 + norm * 0.9;
        mesh.scale.y += (h - mesh.scale.y) * 0.08;
        mesh.position.y = (1.4 * mesh.scale.y) / 2;
      }
    }
  });

  return (
    <>
      {TOWERS.map((t, i) => {
        const [x, z] = lonLatToXZ(t.lon, t.lat);
        return (
          <group key={t.name} position={[x, 0, z]}>
            <mesh
              ref={(m) => (groupRefs.current[i] = m)}
              position={[0, 0.7, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.18, 0.26, 1.4, 6]} />
              <meshStandardMaterial
                ref={(m) => (matRefs.current[i] = m)}
                color="#1b2b4a"
                emissive="#6ea8ff"
                emissiveIntensity={0.8}
                roughness={0.4}
              />
            </mesh>
            <Text
              position={[0, 1.9, 0]}
              fontSize={0.28}
              color="#dbe7ff"
              anchorX="center"
              anchorY="bottom"
              outlineWidth={0.012}
              outlineColor="#06090d"
            >
              {t.label}
            </Text>
          </group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sparks: ONE instanced mesh, ring-buffer reuse, bezier flight over ~1.2 s.
// Under reduced motion, a spark shows a brief static marker at the tower.
// ---------------------------------------------------------------------------
interface SparkState {
  active: boolean;
  start: Vec3;
  ctrl: Vec3;
  end: Vec3;
  color: THREE.Color;
  t: number; // 0..1
}

function Sparks({
  sparkQueueRef,
}: {
  sparkQueueRef: React.MutableRefObject<
    { start: Vec3; end: Vec3; color: string }[]
  >;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const states = useMemo<SparkState[]>(
    () =>
      Array.from({ length: POOL }, () => ({
        active: false,
        start: [0, 0, 0] as Vec3,
        ctrl: [0, 0, 0] as Vec3,
        end: [0, 0, 0] as Vec3,
        color: new THREE.Color(),
        t: 0,
      })),
    []
  );
  const cursor = useRef(0);

  useEffect(() => {
    // Hide all instances initially (scale 0).
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < POOL; i++) {
      dummy.position.set(0, -999, 0);
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color("#000000"));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return () => {
      mesh.geometry.dispose();
    };
  }, [dummy, states]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Drain the queue into free slots.
    const q = sparkQueueRef.current;
    while (q.length > 0) {
      const item = q.shift()!;
      const slot = states[cursor.current];
      cursor.current = (cursor.current + 1) % POOL;
      slot.active = true;
      slot.start = item.start;
      slot.end = item.end;
      slot.ctrl = arcControlPoint(item.start, item.end);
      slot.color.set(item.color);
      // Reduced motion: drop the spark straight at the tower, brief marker.
      slot.t = prefersReducedMotion ? 0.92 : 0;
      mesh.setColorAt(cursor.current === 0 ? POOL - 1 : cursor.current - 1, slot.color);
    }

    let anyActive = false;
    for (let i = 0; i < POOL; i++) {
      const s = states[i];
      if (!s.active) continue;
      anyActive = true;
      s.t += delta / SPARK_DURATION;
      if (s.t >= 1) {
        s.active = false;
        dummy.position.set(0, -999, 0);
        dummy.scale.setScalar(0);
      } else {
        const p = bezierPoint(s.start, s.ctrl, s.end, s.t);
        dummy.position.set(p[0], p[1], p[2]);
        // Fade size in and out along the flight.
        const fade = Math.sin(Math.PI * s.t);
        dummy.scale.setScalar(0.06 + fade * 0.12);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    if (anyActive) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, POOL]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshStandardMaterial
        emissive="#ffffff"
        emissiveIntensity={2.2}
        toneMapped={false}
        vertexColors={false}
      />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Camera: orthographic at an isometric angle, real depth so B9 can push in.
// ---------------------------------------------------------------------------
function IsoCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    const aspect = size.width / size.height;
    const frustum = 16;
    cam.left = (-frustum * aspect) / 2;
    cam.right = (frustum * aspect) / 2;
    cam.top = frustum / 2;
    cam.bottom = -frustum / 2;
    cam.near = 0.1;
    cam.far = 100;
    cam.position.set(14, 16, 16);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

// ---------------------------------------------------------------------------
// Engine: owns the EventProcessor and turns effects into refs/queue updates.
// This component renders nothing; it just wires events to the scene refs.
// ---------------------------------------------------------------------------
function EventEngine({
  events,
  levelRef,
  wattsRef,
  sparkQueueRef,
  onLevel,
}: {
  events: DownshiftEvent[];
  levelRef: React.MutableRefObject<GridLevel>;
  wattsRef: React.MutableRefObject<number>;
  sparkQueueRef: React.MutableRefObject<{ start: Vec3; end: Vec3; color: string }[]>;
  onLevel: (lvl: GridLevel) => void;
}) {
  const processorRef = useRef<EventProcessor | null>(null);
  if (!processorRef.current) {
    processorRef.current = new EventProcessor(CENTROIDS);
  }

  useEffect(() => {
    const proc = processorRef.current!;
    for (const ev of events) {
      const eff: Effect | null = proc.process(ev);
      if (!eff) continue;
      if (eff.kind === "level") {
        levelRef.current = eff.level;
        onLevel(eff.level);
      } else if (eff.kind === "power") {
        wattsRef.current = eff.watts;
      } else if (eff.kind === "spark") {
        const start = toGround(eff.lon, eff.lat);
        const end = nearestTowerTop(eff.lon, eff.lat);
        sparkQueueRef.current.push({ start, end, color: eff.color });
        // Keep the queue bounded in case of a burst.
        if (sparkQueueRef.current.length > POOL) {
          sparkQueueRef.current.splice(0, sparkQueueRef.current.length - POOL);
        }
      }
    }
  }, [events, levelRef, wattsRef, sparkQueueRef, onLevel]);

  return null;
}

function toGround(lon: number, lat: number): Vec3 {
  const [x, z] = lonLatToXZ(lon, lat);
  return [x, 0.2, z];
}
function nearestTowerTop(lon: number, lat: number): Vec3 {
  const t = TOWERS[nearestTowerIndex(lon, lat)];
  const [x, z] = lonLatToXZ(t.lon, t.lat);
  return [x, 1.6, z];
}

// ---------------------------------------------------------------------------
// Scene (default export) — the fixed contract.
// ---------------------------------------------------------------------------
export default function Scene({ events }: { events: DownshiftEvent[] }) {
  const levelRef = useRef<GridLevel>("green");
  const wattsRef = useRef<number>(0);
  const sparkQueueRef = useRef<{ start: Vec3; end: Vec3; color: string }[]>([]);
  // The ONLY React state here changes at human speed (level words), never per
  // frame or per high-rate event — it drives the aria-label + live region.
  const [level, setLevel] = useState<GridLevel>("green");

  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      role="img"
      aria-label={`Massachusetts grid room, grid level ${level}`}
    >
      {/* Visually-hidden live region announces level changes (colour is never
          the only signal). */}
      <div
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {`Grid level ${level}`}
      </div>

      <Canvas
        orthographic
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
      >
        <color attach="background" args={["#06090d"]} />
        <IsoCamera />
        <ambientLight intensity={0.5} />
        <directionalLight position={[12, 18, 8]} intensity={1.1} castShadow />
        <hemisphereLight args={["#2a3b5a", "#05070a", 0.5]} />

        <Ground levelRef={levelRef} />
        <Towers wattsRef={wattsRef} />
        <Sparks sparkQueueRef={sparkQueueRef} />

        <EventEngine
          events={events}
          levelRef={levelRef}
          wattsRef={wattsRef}
          sparkQueueRef={sparkQueueRef}
          onLevel={setLevel}
        />

        <EffectComposer>
          <Bloom
            intensity={0.6}
            luminanceThreshold={0.6}
            luminanceSmoothing={0.2}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
