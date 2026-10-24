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

const LEVEL_COLOR: Record<string, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
};

function LoadCurve({ events }: { events: DownshiftEvent[] }) {
  const loads = events.filter((e) => e.type === "grid.load") as Extract<
    DownshiftEvent,
    { type: "grid.load" }
  >[];
  const state = last(events, "grid.state");
  const level = state?.level ?? "green";
  const color = LEVEL_COLOR[level];

  const pts = loads.slice(-120).map((e) => e.load_mw);
  const w = 212;
  const h = 48;
  let path = "";
  if (pts.length > 1) {
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    path = pts
      .map((v, i) => {
        const x = (i / (pts.length - 1)) * w;
        const y = h - ((v - min) / span) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }
  const currentMw = state?.load_mw ?? pts[pts.length - 1] ?? 0;

  return (
    <div style={PANEL}>
      <div style={{ color: "#8b949e", textTransform: "uppercase", fontSize: 11 }}>
        Grid load
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 600 }}>
          {currentMw.toLocaleString(undefined, { maximumFractionDigits: 0 })} MW
        </span>
        <span style={{ color, textTransform: "uppercase", fontWeight: 600 }}>
          {level}
        </span>
      </div>
      <svg width={w} height={h} style={{ marginTop: 6, display: "block" }}>
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </div>
  );
}

function Scorecard({ events }: { events: DownshiftEvent[] }) {
  const card = last(events, "scorecard.update");
  if (!card) return null;
  const nd = card.no_downshift;
  const ds = card.downshift;
  const saved =
    nd.j_per_answer > 0
      ? ((nd.j_per_answer - ds.j_per_answer) / nd.j_per_answer) * 100
      : 0;

  const row = (label: string, a: number, b: number, unit: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ color: "#8b949e" }}>{label}</span>
      <span>
        <span style={{ color: "#8b949e" }}>{a.toFixed(1)}</span>
        {" → "}
        <span style={{ color: "#22c55e" }}>
          {b.toFixed(1)}
          {unit}
        </span>
      </span>
    </div>
  );

  return (
    <div style={PANEL}>
      <div style={{ color: "#8b949e", textTransform: "uppercase", fontSize: 11 }}>
        Scorecard · No Downshift → Downshift
      </div>
      {row("joules / answer", nd.j_per_answer, ds.j_per_answer, " J")}
      {row("p50 latency", nd.p50_latency_ms, ds.p50_latency_ms, " ms")}
      {row("quality match", nd.quality_match_pct, ds.quality_match_pct, " %")}
      <div style={{ marginTop: 6, fontWeight: 600, color: "#22c55e" }}>
        {saved.toFixed(0)}% energy saved
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
      <LoadCurve events={events} />
      <Scorecard events={events} />
    </div>
  );
}
