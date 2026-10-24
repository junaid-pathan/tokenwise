// The Grid Room "world" view: a voxel Holyoke diorama with a game-style HUD.
//
// Two modes:
//   Simulation — the replayed grid day and the simulated crowd, every prompt
//                flies from a home to the data center.
//   Live       — only real prompts (claude.ai via the extension, the
//                Downshift panel) fly; the crowd is hidden.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DownshiftEvent, GridLevel } from "../../../../contracts/events";
import {
  ENGINE,
  SPEEDS,
  DEFAULT_SPEED,
  actionForKey,
  describe,
  isTypingTarget,
  replayMinutes,
  requestFor,
  simulatedLabels,
  type DemoAction,
} from "../demo";
import { buildWorld } from "./terrain";
import {
  WorldProcessor,
  clockMinutes,
  energySavedPct,
  formatClock,
  formatMw,
  type OrbEffect,
  type Snapshot,
} from "./worldState";
import World3D from "./World3D";
import "./world.css";

type Mode = "sim" | "live";
const LEVEL_WORD: Record<GridLevel, string> = { green: "Green", yellow: "Yellow", red: "Red" };
const SPEED_LABEL: Record<"1" | "2" | "3", string> = { "1": "6 min", "2": "3 min", "3": "90 s" };

function Sparkline({ values, level }: { values: number[]; level: GridLevel | null }) {
  if (values.length < 2) return <div className="w-spark empty">waiting for load…</div>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - lo) / span) * 26}`)
    .join(" ");
  return (
    <svg className={`w-spark ${level ?? ""}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="w-stat">
      <span className="w-stat-label">{label}</span>
      <span className="w-stat-value">{value}</span>
      {sub && <span className="w-stat-sub">{sub}</span>}
    </div>
  );
}

export default function World({ events, connected }: { events: DownshiftEvent[]; connected: boolean }) {
  const layout = useMemo(() => buildWorld(7), []);
  const procRef = useRef<WorldProcessor | null>(null);
  if (!procRef.current) procRef.current = new WorldProcessor(layout.homes.length);

  const levelRef = useRef<GridLevel>("green");
  const queueRef = useRef<OrbEffect[]>([]);
  const flashRef = useRef(0);
  const clearRef = useRef(false);
  const resetCamRef = useRef(false);
  const speedRef = useRef(DEFAULT_SPEED);
  const modeRef = useRef<Mode>("sim");

  const [mode, setModeState] = useState<Mode>("sim");
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [snap, setSnap] = useState<Snapshot>(() => procRef.current!.snapshot());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const setMode = useCallback((m: Mode) => {
    modeRef.current = m;
    setModeState(m);
    clearRef.current = true; // drop in-flight crowd orbs when switching
  }, []);

  // Feed new events to the processor; queue orbs; never per-event React state.
  useEffect(() => {
    const proc = procRef.current!;
    for (const ev of events) {
      const orb = proc.process(ev);
      if (ev.type === "grid.state") levelRef.current = ev.level;
      if (!orb) continue;
      if (modeRef.current === "live" && !orb.you) continue;
      queueRef.current.push(orb);
      if (queueRef.current.length > 768) queueRef.current.splice(0, queueRef.current.length - 768);
    }
  }, [events]);

  // Overlay numbers refresh at a human pace.
  useEffect(() => {
    const id = window.setInterval(() => setSnap(procRef.current!.snapshot()), 300);
    return () => window.clearInterval(id);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const run = useCallback(
    (action: DemoAction) => {
      if (action.kind === "replay") {
        speedRef.current = action.speed;
        setSpeed(action.speed);
      }
      if (action.kind === "reset") {
        clearRef.current = true;
        resetCamRef.current = true;
        speedRef.current = DEFAULT_SPEED;
        setSpeed(DEFAULT_SPEED);
      }
      const { path, body } = requestFor(action);
      fetch(`${ENGINE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => showToast(r.ok ? describe(action) : `Engine said ${r.status}`))
        .catch(() => showToast("Engine offline"));
    },
    [showToast]
  );

  // Presenter keys: R replay, 1-3 speed, A alert, X reset, S/L switch mode.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      const k = e.key.toLowerCase();
      if (k === "s") return setMode("sim");
      if (k === "l") return setMode("live");
      const action = actionForKey(e.key, { speed: speedRef.current, level: levelRef.current });
      if (action) run(action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, setMode]);

  const minutes = clockMinutes(snap.replayClock);
  const progress = minutes == null ? 0 : (minutes / 1440) * 100;
  const saved = energySavedPct(snap.scorecard);
  const sc = snap.scorecard;
  const level = snap.level;
  const simTags = simulatedLabels(snap.simFlags);
  const downPct = snap.routed ? Math.round((snap.downshifted / snap.routed) * 100) : 0;
  const decisions = mode === "live" ? snap.decisions.filter((d) => d.tone === "you") : snap.decisions;

  return (
    <div className="w-root" data-level={level ?? "none"}>
      <div className="w-canvas" role="img" aria-label={`Holyoke grid world. Grid level ${level ?? "unknown"}.`}>
        <World3D
          layout={layout}
          levelRef={levelRef}
          queueRef={queueRef}
          flashRef={flashRef}
          clearRef={clearRef}
          resetCamRef={resetCamRef}
          you={snap.lastYou}
        />
      </div>
      <div className="visually-hidden" aria-live="polite">
        {level ? `Grid level ${LEVEL_WORD[level]}` : ""}
      </div>

      {/* ---- Top bar ---- */}
      <header className="w-top">
        <div className="w-brand">
          <span className="w-logo" aria-hidden="true" />
          <span className="w-name">DOWNSHIFT</span>
          <span className="w-place">Holyoke, MA</span>
        </div>

        <nav className="w-tabs" aria-label="View mode">
          <button className={mode === "sim" ? "on" : ""} aria-pressed={mode === "sim"} onClick={() => setMode("sim")}>
            <kbd>S</kbd> Simulation
          </button>
          <button className={mode === "live" ? "on" : ""} aria-pressed={mode === "live"} onClick={() => setMode("live")}>
            <kbd>L</kbd> Live
          </button>
        </nav>

        <div className="w-transport">
          <button
            className="w-play"
            aria-label="Replay the grid day"
            title="Replay (R)"
            onClick={() => run({ kind: "replay", speed: speedRef.current })}
          >
            ▶
          </button>
          {(["1", "2", "3"] as const).map((k) => (
            <button
              key={k}
              className={`w-speed${speed === SPEEDS[k] ? " on" : ""}`}
              aria-pressed={speed === SPEEDS[k]}
              title={`24 h in ${SPEED_LABEL[k]} (${k})`}
              onClick={() => run({ kind: "replay", speed: SPEEDS[k] })}
            >
              {SPEED_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="w-timeline" aria-label={`Replay clock ${formatClock(minutes)}`}>
          <div className="w-track">
            <div className="w-fill" style={{ width: `${progress}%` }} />
            <div className="w-peak" style={{ left: `${(17 * 60 / 1440) * 100}%` }} title="Afternoon peak" />
          </div>
          <span className="w-clock">{formatClock(minutes)}</span>
          <span className="w-date">Jun 24, 2025</span>
        </div>

        <div className="w-right">
          <span className={`w-level ${level ?? ""}`}>
            <i aria-hidden="true" />
            {level ? LEVEL_WORD[level] : "—"}
          </span>
          <button className="w-alert" onClick={() => run({ kind: "alert", level: level === "red" ? "green" : "red" })}>
            {level === "red" ? "Clear alert" : "Grid alert"}
          </button>
          <span className={`w-conn ${connected ? "up" : "down"}`}>{connected ? "● LIVE" : "○ OFFLINE"}</span>
        </div>
      </header>

      {/* ---- Left: stats ---- */}
      <aside className="w-panel w-left" aria-label="Grid and energy">
        <h2>Grid · ISO New England</h2>
        <div className="w-grid-row">
          <span className={`w-big ${level ?? ""}`}>{level ? LEVEL_WORD[level] : "—"}</span>
          <span className="w-mw">{formatMw(snap.loadMw)}</span>
        </div>
        <Sparkline values={snap.loadHistory} level={level} />

        <h2>Data center</h2>
        <div className="w-watts">
          <span className="w-stat-value">{snap.watts == null ? "--" : `${snap.watts.toFixed(1)} W`}</span>
          <span className="w-stat-sub">{snap.powerSource === "estimate" ? "estimated" : snap.powerSource || "—"}</span>
        </div>
        <div className="w-bar" aria-hidden="true">
          <div style={{ width: `${Math.min(100, ((snap.watts ?? 0) / 90) * 100)}%` }} />
        </div>

        <h2>Prompts</h2>
        <div className="w-stats">
          <Stat label="routed" value={snap.routed.toLocaleString("en-US")} />
          <Stat label="shifted down" value={`${downPct}%`} sub={snap.downshifted.toLocaleString("en-US")} />
          <Stat label="deferred" value={snap.deferred.toLocaleString("en-US")} />
          <Stat label="yours" value={String(snap.youCount)} />
        </div>

        <h2>Energy</h2>
        <div className="w-saved">
          <span className="w-saved-num">{saved == null ? "--" : `${saved}%`}</span>
          <span className="w-stat-sub">saved per answer</span>
        </div>
        {sc && (
          <dl className="w-score">
            <dt>joules / answer</dt>
            <dd>
              {sc.no_downshift.j_per_answer.toFixed(0)} → <b>{sc.downshift.j_per_answer.toFixed(0)}</b>
            </dd>
            <dt>quality match</dt>
            <dd>
              <b>{sc.downshift.quality_match_pct.toFixed(0)}%</b>
            </dd>
            <dt>p50 latency</dt>
            <dd>
              {sc.no_downshift.p50_latency_ms.toFixed(0)} → <b>{sc.downshift.p50_latency_ms.toFixed(0)} ms</b>
            </dd>
          </dl>
        )}
      </aside>

      {/* ---- Right: decisions ---- */}
      <aside className="w-panel w-right-panel" aria-label="Decisions">
        <h2>Decisions</h2>
        {decisions.length === 0 ? (
          <p className="w-empty">
            {mode === "live" ? "Send a prompt on claude.ai or in the Downshift panel." : "Waiting for the agents…"}
          </p>
        ) : (
          <ol className="w-log">
            {decisions.slice(0, 9).map((d) => (
              <li key={d.id} className={`t-${d.tone}`}>
                <b>
                  {d.title}
                  {d.count > 1 && <em className="w-count">×{d.count}</em>}
                </b>
                <span>{d.detail}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>

      {/* ---- Live empty state ---- */}
      {mode === "live" && snap.youCount === 0 && (
        <div className="w-panel w-live-hint">
          <h2>Live mode</h2>
          <p>Only real prompts show here. Send one on claude.ai or in the Downshift panel and watch it fly from the blue house.</p>
        </div>
      )}

      {/* ---- Narrator ---- */}
      {snap.narrator && (
        <div className="w-narrator" aria-live="polite">
          <span className="w-narrator-tag">Narrator</span>
          {snap.narrator}
        </div>
      )}

      {/* ---- Bottom: legend + simulated tags ---- */}
      <div className="w-panel w-legend" aria-label="Legend">
        <span><i className="sw amber" /> Full power</span>
        <span><i className="sw green" /> Shifted down</span>
        <span><i className="sw you" /> Your prompt</span>
        <span><i className="sw beam" /> Beacon = grid level</span>
      </div>
      <div className="w-corner">
        {simTags.map((t) => (
          <span key={t} className="w-sim">{t}</span>
        ))}
        <span className="w-keys">
          R replay · 1-3 speed · A alert · X reset · S/L mode · drag to orbit
        </span>
      </div>

      {toast && (
        <div className="w-toast" role="status">
          {toast}
        </div>
      )}
      <span className="visually-hidden">Replay speed: 24 hours in {replayMinutes(speed)} minutes.</span>
    </div>
  );
}
