// A (PR A11): HUD — wattmeter, load curve + playhead, scorecard panel,
// negotiation log, narrator ticker. Stub for now.
import type { DownshiftEvent } from "../../../contracts/events";

export default function Hud({
  events,
  connected,
}: {
  events: DownshiftEvent[];
  connected: boolean;
}) {
  const last = events[events.length - 1];
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        color: "#e6edf3",
        font: "14px system-ui, sans-serif",
        background: "rgba(6,9,13,0.6)",
        padding: "12px 16px",
        borderRadius: 10,
      }}
    >
      <div>HUD stub · owner A / Aru · PR A11</div>
      <div style={{ color: connected ? "#22c55e" : "#ef4444" }}>
        {connected ? "stream connected" : "stream offline"}
      </div>
      <div style={{ color: "#8b949e" }}>
        events: {events.length}
        {last ? ` · last: ${last.type}` : ""}
      </div>
    </div>
  );
}
