// A (PR A11): HUD — wattmeter, load curve + playhead, scorecard panel,
// negotiation log, narrator ticker. Reads the live event stream.
import type { DownshiftEvent } from "../../../contracts/events";

const PANEL: React.CSSProperties = {
  color: "#e6edf3",
  font: "13px system-ui, sans-serif",
  background: "rgba(6,9,13,0.72)",
  padding: "10px 14px",
  borderRadius: 10,
  marginBottom: 10,
  minWidth: 220,
};

function last<K extends DownshiftEvent["type"]>(
  events: DownshiftEvent[],
  type: K,
): Extract<DownshiftEvent, { type: K }> | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === type) {
      return events[i] as Extract<DownshiftEvent, { type: K }>;
    }
  }
  return undefined;
}

function Wattmeter({ events }: { events: DownshiftEvent[] }) {
  const sample = last(events, "power.sample");
  const watts = sample?.watts ?? 0;
  // scale a simple bar against a nominal 80 W full-scale for a T4 under load
  const pct = Math.max(0, Math.min(100, (watts / 80) * 100));
  return (
    <div style={PANEL}>
      <div style={{ color: "#8b949e", textTransform: "uppercase", fontSize: 11 }}>
        Wattmeter {sample ? `· ${sample.device}` : ""}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600 }}>{watts.toFixed(1)} W</div>
      <div style={{ height: 8, background: "#1b2430", borderRadius: 4, marginTop: 6 }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "#38bdf8",
            borderRadius: 4,
            transition: "width 0.3s",
          }}
        />
      </div>
    </div>
  );
}

export default function Hud({
  events,
  connected,
}: {
  events: DownshiftEvent[];
  connected: boolean;
}) {
  return (
    <div style={{ position: "absolute", top: 16, left: 16, width: 240 }}>
      <div style={{ ...PANEL, display: "flex", justifyContent: "space-between" }}>
        <strong>Downshift</strong>
        <span style={{ color: connected ? "#22c55e" : "#ef4444" }}>
          {connected ? "● live" : "○ offline"}
        </span>
      </div>
      <Wattmeter events={events} />
    </div>
  );
}
