// B (PR B7): the 3D Grid Room scene.
//
// Contract (do NOT change the signature — App.tsx depends on it):
//   export default function Scene({ events }: { events: DownshiftEvent[] })
// `events` is the most recent <=200 bus events in arrival order. We process
// each event exactly once (dedup by id in EventProcessor) and do all per-event
// work in refs / useFrame, never in React render, so a fast stream never
// rebuilds the scene.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  ENGINE,
  DEFAULT_SPEED,
  actionForKey,
  describe,
  isTypingTarget,
  requestFor,
  simulatedFlag,
  simulatedLabels,
} from "./demo";
import townData from "./data/ma-towns.json";
import centroidsJson from "./data/town-centroids.json";

const CENTROIDS = centroidsJson as unknown as Record<string, [number, number]>;

const POOL = 512; // spark instances (ring buffer)
const FRUSTUM = 16; // resting orthographic frustum height
const FRUSTUM_ALERT = 11; // pushed-in frustum while the grid is red

type SparkItem = { start: Vec3; end: Vec3; color: string; tower: number };
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Per-tower label placement so the close western pair does not overlap.
// Holyoke sits just NE of Westfield (~13 mi); push Holyoke's label up-right
// and Westfield's down-left so the two never collide. Lowell stays high/centre.
const LABEL_PLACEMENT: Record<
  string,
  { pos: [number, number, number]; anchorX: "left" | "center" | "right" }
> = {
  Holyoke: { pos: [0.9, 2.5, -0.4], anchorX: "left" },
  Westfield: { pos: [-0.9, 1.7, 0.5], anchorX: "right" },
  Lowell: { pos: [0, 2.2, 0], anchorX: "center" },
};

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
    // Keep tiles dark and readable, but clearly tinted: material.color is the
    // level colour scaled down (not multiplied by a grey vertex colour, which
    // used to wash red into olive). Enough punch to read green/yellow/red.
    const [r, g, b] = hexToRgb(levelColor(levelRef.current));
    const target = new THREE.Color(r, g, b).multiplyScalar(0.45).addScalar(0.02);
    current.current.lerp(target, 0.08);
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
// Towers: three glowing prisms with labels; glow/height follow live watts,
// and each tower flashes briefly when a spark lands on it.
// ---------------------------------------------------------------------------
function Towers({
  wattsRef,
  flashRef,
}: {
  wattsRef: React.MutableRefObject<number>;
  flashRef: React.MutableRefObject<number[]>;
}) {
  const groupRefs = useRef<(THREE.Mesh | null)[]>([]);
  const matRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const smoothed = useRef(55); // idle glow baseline (W)

  useFrame((_, delta) => {
    // Smooth the watts (exponential). 40..90 W -> normalised 0..1.
    smoothed.current += (wattsRef.current - smoothed.current) * 0.05;
    const norm = THREE.MathUtils.clamp((smoothed.current - 35) / 60, 0, 1);
    const decay = Math.exp(-4 * delta);
    for (let i = 0; i < TOWERS.length; i++) {
      const mesh = groupRefs.current[i];
      const mat = matRefs.current[i];
      const flash = flashRef.current[i] ?? 0;
      flashRef.current[i] = flash < 0.01 ? 0 : flash * decay;
      if (mat) mat.emissiveIntensity = 0.6 + norm * 2.2 + flash * 2.5;
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
        // Per-tower label placement so the close pair (Holyoke / Westfield,
        // ~13 mi apart) does not collide. Holyoke anchors right+high,
        // Westfield anchors left+low; Lowell stays centred & high.
        const lp = LABEL_PLACEMENT[t.name] ?? {
          pos: [0, 1.9, 0] as [number, number, number],
          anchorX: "center" as const,
        };
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
            {/* Leader line from the tower top to the label anchor. */}
            <line>
              <bufferGeometry
                attach="geometry"
                onUpdate={(g) =>
                  g.setFromPoints([
                    new THREE.Vector3(0, 1.5, 0),
                    new THREE.Vector3(lp.pos[0], lp.pos[1], lp.pos[2]),
                  ])
                }
              />
              <lineBasicMaterial attach="material" color="#3a4a66" transparent opacity={0.6} />
            </line>
            <Text
              position={lp.pos}
              fontSize={0.28}
              color="#dbe7ff"
              anchorX={lp.anchorX}
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
  tower: number; // index into TOWERS, flashed on landing
}

function Sparks({
  sparkQueueRef,
  flashRef,
  clearRef,
}: {
  sparkQueueRef: React.MutableRefObject<SparkItem[]>;
  flashRef: React.MutableRefObject<number[]>;
  // Set true by the demo reset (X); the next frame drops every spark.
  clearRef: React.MutableRefObject<boolean>;
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
        tower: 0,
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

    let forceUpdate = false;
    if (clearRef.current) {
      clearRef.current = false;
      sparkQueueRef.current.length = 0;
      for (let i = 0; i < POOL; i++) {
        if (!states[i].active) continue;
        states[i].active = false;
        dummy.position.set(0, -999, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      forceUpdate = true;
    }

    // Drain the queue into free slots (ring buffer by cursor).
    const q = sparkQueueRef.current;
    while (q.length > 0) {
      const item = q.shift()!;
      const idx = cursor.current;
      cursor.current = (cursor.current + 1) % POOL;
      const slot = states[idx];
      slot.active = true;
      slot.start = item.start;
      slot.end = item.end;
      slot.ctrl = arcControlPoint(item.start, item.end);
      slot.color.set(item.color);
      slot.tower = item.tower;
      // Reduced motion: drop the spark straight at the tower, brief marker.
      slot.t = prefersReducedMotion ? 0.92 : 0;
      mesh.setColorAt(idx, slot.color);
    }

    let anyActive = false;
    for (let i = 0; i < POOL; i++) {
      const s = states[i];
      if (!s.active) continue;
      anyActive = true;
      s.t += delta / SPARK_DURATION;
      if (s.t >= 1) {
        s.active = false;
        flashRef.current[s.tower] = 1; // landed: the tower glows briefly
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
    if (anyActive || forceUpdate) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, POOL]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 8]} />
      {/* Basic (unlit) material so the per-instance colour shows directly and
          bloom picks it up. A MeshStandardMaterial with a white emissive was
          washing every spark to white regardless of setColorAt. */}
      <meshBasicMaterial toneMapped={false} vertexColors={false} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Camera: orthographic at an isometric angle. Pushes in (smaller frustum)
// while the grid is red and eases back out after; snaps under reduced motion.
// ---------------------------------------------------------------------------
function CameraRig({
  levelRef,
  resetRef,
}: {
  levelRef: React.MutableRefObject<GridLevel>;
  // Set true by the demo reset (X); the camera jumps back to rest.
  resetRef: React.MutableRefObject<boolean>;
}) {
  const { camera, size } = useThree();
  const frustum = useRef(FRUSTUM);
  const applied = useRef(-1); // frustum last written to the projection

  const apply = (cam: THREE.OrthographicCamera, f: number) => {
    const aspect = size.width / size.height;
    cam.left = (-f * aspect) / 2;
    cam.right = (f * aspect) / 2;
    cam.top = f / 2;
    cam.bottom = -f / 2;
    cam.updateProjectionMatrix();
    applied.current = f;
  };

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.near = 0.1;
    cam.far = 100;
    cam.position.set(14, 16, 16);
    cam.lookAt(0, 0, 0);
    apply(cam, frustum.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size]);

  useFrame((_, delta) => {
    const cam = camera as THREE.OrthographicCamera;
    if (resetRef.current) {
      resetRef.current = false;
      frustum.current = FRUSTUM;
    }
    const target = levelRef.current === "red" ? FRUSTUM_ALERT : FRUSTUM;
    if (prefersReducedMotion) {
      frustum.current = target;
    } else {
      const f = frustum.current + (target - frustum.current) * (1 - Math.exp(-2.5 * delta));
      frustum.current = Math.abs(f - target) < 0.005 ? target : f;
    }
    if (frustum.current !== applied.current) apply(cam, frustum.current);
  });
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
  onSimulated,
}: {
  events: DownshiftEvent[];
  levelRef: React.MutableRefObject<GridLevel>;
  wattsRef: React.MutableRefObject<number>;
  sparkQueueRef: React.MutableRefObject<SparkItem[]>;
  onLevel: (lvl: GridLevel) => void;
  onSimulated: (flags: number) => void;
}) {
  const processorRef = useRef<EventProcessor | null>(null);
  if (!processorRef.current) {
    processorRef.current = new EventProcessor(CENTROIDS);
  }

  useEffect(() => {
    const proc = processorRef.current!;
    // Which non-live sources are in the current window (for the labels).
    // React skips the update when the number is unchanged.
    let flags = 0;
    for (const ev of events) flags |= simulatedFlag(ev);
    onSimulated(flags);
    for (const ev of events) {
      const eff: Effect | null = proc.process(ev);
      if (!eff) continue;
      if (eff.kind === "level") {
        levelRef.current = eff.level;
        onLevel(eff.level);
      } else if (eff.kind === "power") {
        wattsRef.current = eff.watts;
      } else if (eff.kind === "spark") {
        const tower = nearestTowerIndex(eff.lon, eff.lat);
        const start = toGround(eff.lon, eff.lat);
        const end = towerTop(tower);
        sparkQueueRef.current.push({ start, end, color: eff.color, tower });
        // Keep the queue bounded in case of a burst.
        if (sparkQueueRef.current.length > POOL) {
          sparkQueueRef.current.splice(0, sparkQueueRef.current.length - POOL);
        }
      }
    }
  }, [events, levelRef, wattsRef, sparkQueueRef, onLevel, onSimulated]);

  return null;
}

function toGround(lon: number, lat: number): Vec3 {
  const [x, z] = lonLatToXZ(lon, lat);
  return [x, 0.2, z];
}
function towerTop(index: number): Vec3 {
  const t = TOWERS[index];
  const [x, z] = lonLatToXZ(t.lon, t.lat);
  return [x, 1.6, z];
}

// ---------------------------------------------------------------------------
// Demo keys (B9): R replay, 1-3 speed, A alert, X reset. A plain window
// listener; it ignores key repeats, modifier combos and text fields.
// ---------------------------------------------------------------------------
function useDemoKeys({
  levelRef,
  clearRef,
  cameraResetRef,
  flashRef,
  toast,
}: {
  levelRef: React.MutableRefObject<GridLevel>;
  clearRef: React.MutableRefObject<boolean>;
  cameraResetRef: React.MutableRefObject<boolean>;
  flashRef: React.MutableRefObject<number[]>;
  toast: (msg: string) => void;
}) {
  const speedRef = useRef(DEFAULT_SPEED);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      const action = actionForKey(e.key, {
        speed: speedRef.current,
        level: levelRef.current,
      });
      if (!action) return;
      e.preventDefault();

      if (action.kind === "replay") speedRef.current = action.speed;
      if (action.kind === "reset") {
        speedRef.current = DEFAULT_SPEED;
        clearRef.current = true;
        cameraResetRef.current = true;
        flashRef.current = TOWERS.map(() => 0);
      }

      const { path, body } = requestFor(action);
      fetch(`${ENGINE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((res) => toast(res.ok ? describe(action) : `Engine error ${res.status}`))
        .catch(() => toast("Engine offline"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [levelRef, clearRef, cameraResetRef, flashRef, toast]);
}

// Shared look for the DOM overlays: dark glass matching the scene background.
const overlayChip: React.CSSProperties = {
  background: "rgba(6, 9, 13, 0.78)",
  border: "1px solid rgba(219, 231, 255, 0.22)",
  borderRadius: 6,
  color: "#dbe7ff",
  font: "600 11px ui-monospace, Consolas, monospace",
  letterSpacing: 0.4,
  padding: "4px 8px",
};

// ---------------------------------------------------------------------------
// Scene (default export) — the fixed contract.
// ---------------------------------------------------------------------------
export default function Scene({ events }: { events: DownshiftEvent[] }) {
  const levelRef = useRef<GridLevel>("green");
  const wattsRef = useRef<number>(0);
  const sparkQueueRef = useRef<SparkItem[]>([]);
  const flashRef = useRef<number[]>(TOWERS.map(() => 0));
  const clearRef = useRef(false);
  const cameraResetRef = useRef(false);
  // React state here changes at human speed only (level word, simulated
  // flags, toast), never per frame or per high-rate event.
  const [level, setLevel] = useState<GridLevel>("green");
  const [simFlags, setSimFlags] = useState(0);
  const [toastMsg, setToastMsg] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(""), 2500);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  useDemoKeys({ levelRef, clearRef, cameraResetRef, flashRef, toast });

  const simLabels = simulatedLabels(simFlags);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
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
          <CameraRig levelRef={levelRef} resetRef={cameraResetRef} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[12, 18, 8]} intensity={1.1} castShadow />
          <hemisphereLight args={["#2a3b5a", "#05070a", 0.5]} />
  
          <Ground levelRef={levelRef} />
          <Towers wattsRef={wattsRef} flashRef={flashRef} />
          <Sparks sparkQueueRef={sparkQueueRef} flashRef={flashRef} clearRef={clearRef} />
  
          <EventEngine
            events={events}
            levelRef={levelRef}
            wattsRef={wattsRef}
            sparkQueueRef={sparkQueueRef}
            onLevel={setLevel}
            onSimulated={setSimFlags}
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

      {/* Demo feedback toast, top-centre (the HUD owns the top-left). */}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      >
        {toastMsg && <div style={{ ...overlayChip, fontSize: 12, padding: "6px 12px" }}>{toastMsg}</div>}
      </div>

      {/* "Simulated" labels and the demo-key legend, bottom-right. */}
      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        {simLabels.map((label) => (
          <span key={label} style={{ ...overlayChip, textTransform: "uppercase" }}>
            {label}
          </span>
        ))}
        <span style={{ ...overlayChip, color: "#9fb0cc", fontWeight: 500 }}>
          R replay · A alert · 1-3 speed · X reset
        </span>
      </div>
    </div>
  );
}
