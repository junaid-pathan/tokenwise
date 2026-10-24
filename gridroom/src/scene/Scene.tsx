// B (PR B7): 3D scene — Massachusetts tiles, data-center towers, sparks from
// the stream, isometric camera, demo keys. Stub renders a placeholder box so
// the layout works before the real scene lands.
import { Canvas } from "@react-three/fiber";
import type { DownshiftEvent } from "../../../contracts/events";

export default function Scene({ events }: { events: DownshiftEvent[] }) {
  // Tint the floor by the latest grid.state level (placeholder behaviour).
  const level =
    [...events].reverse().find((e) => e.type === "grid.state") as
      | Extract<DownshiftEvent, { type: "grid.state" }>
      | undefined;
  const color =
    level?.level === "red"
      ? "#ef4444"
      : level?.level === "yellow"
      ? "#eab308"
      : "#22c55e";

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas camera={{ position: [4, 4, 4], fov: 40 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[6, 6]} />
          <meshStandardMaterial color={color} />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[0.6, 1, 0.6]} />
          <meshStandardMaterial color="#1f6feb" />
        </mesh>
      </Canvas>
    </div>
  );
}
