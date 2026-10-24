// JOINT: layout with a hud slot (A) and a scene slot (B).
// Owns the single WS /v1/stream connection and passes events down.
// Edit only via a joint contract: PR.

import { useEffect, useRef, useState } from "react";
import type { DownshiftEvent } from "../../contracts/events";
import Hud from "./hud/Hud";
import Scene from "./scene/Scene";
import World from "./scene/world/World";

const WS_URL = "ws://localhost:8000/v1/stream";
// The voxel world is the default view; ?view=classic shows the state map + HUD.
const CLASSIC = new URLSearchParams(window.location.search).get("view") === "classic";

export default function App() {
  const [events, setEvents] = useState<DownshiftEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) setTimeout(connect, 1000);
      };
      ws.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as DownshiftEvent;
          setEvents((prev) => [...prev.slice(-199), ev]);
        } catch {
          /* ignore malformed frame */
        }
      };
    }
    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  if (!CLASSIC) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <World events={events} connected={connected} />
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* B's 3D scene fills the background */}
      <Scene events={events} />
      {/* A's 2D HUD sits on top */}
      <Hud events={events} connected={connected} />
    </div>
  );
}
