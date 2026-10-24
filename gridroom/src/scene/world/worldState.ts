// Pure event -> world effects + overlay stats. No React, no three.
// Each event is processed exactly once (dedup by id), mirroring effects.ts.
import type { DownshiftEvent, GridLevel, ScorecardUpdate } from "../../../../contracts/events.ts";
import { simulatedFlag } from "../demo.ts";
import { homeIndexFor } from "./terrain.ts";

export const SPARK_AMBER = "#f59e0b"; // ran at the gear it needed
export const SPARK_GREEN = "#22c55e"; // shifted down a gear or more

export interface OrbEffect {
  promptId: string;
  /** Index into layout.homes, or -1 for the "You" home. */
  home: number;
  color: string;
  you: boolean;
}

export type DecisionTone = "you" | "grid" | "utility" | "coordinator" | "ok" | "warn";

export interface Decision {
  id: string;
  ts: number;
  tone: DecisionTone;
  title: string;
  detail: string;
  /** How many identical decisions in a row this row stands for. */
  count: number;
}

export interface YouPrompt {
  promptId: string;
  site: string;
  gearNeeded: number;
  gearUsed: number;
  deferred: boolean;
  at: number; // performance-free wall clock (ms) when it was routed
}

export interface Snapshot {
  level: GridLevel | null;
  loadMw: number | null;
  replayClock: string;
  loadHistory: number[];
  watts: number | null;
  powerSource: string;
  routed: number;
  downshifted: number;
  deferred: number;
  youCount: number;
  scorecard: ScorecardUpdate | null;
  decisions: Decision[];
  narrator: string;
  simFlags: number;
  lastYou: YouPrompt | null;
}

const MAX_SEEN = 8192;
const MAX_PROMPTS = 4096;
const MAX_HISTORY = 240;
const MAX_DECISIONS = 30;

/**
 * True for real prompts (claude.ai via the extension, the Downshift panel).
 * The bus can deliver route.decided before its prompt.received, so the id
 * prefix is checked too, not only the remembered source.
 */
export function isYouPrompt(promptId: string, source: string | undefined): boolean {
  return source === "extension" || promptId.startsWith("claude-") || promptId.startsWith("ext-");
}

/** Where a real prompt came from, from its prompt_id prefix. */
export function siteFor(promptId: string): string {
  if (promptId.startsWith("claude-")) return "Claude";
  return "Downshift panel";
}

/** "2025-06-24T15:05:00" -> minutes since midnight (0..1440), or null. */
export function clockMinutes(clock: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(clock);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight -> "3:05 pm". */
export function formatClock(minutes: number | null): string {
  if (minutes == null) return "--:--";
  const h24 = Math.floor(minutes / 60) % 24;
  const mm = String(Math.floor(minutes % 60)).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "am" : "pm"}`;
}

export function formatMw(mw: number | null): string {
  return mw == null ? "--" : `${Math.round(mw).toLocaleString("en-US")} MW`;
}

/** Percent energy saved per answer, Downshift vs No Downshift. */
export function energySavedPct(sc: ScorecardUpdate | null): number | null {
  if (!sc || !sc.no_downshift.j_per_answer) return null;
  const pct = (1 - sc.downshift.j_per_answer / sc.no_downshift.j_per_answer) * 100;
  return Math.round(pct * 10) / 10;
}

export class WorldProcessor {
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private source = new Map<string, string>();
  private sourceOrder: string[] = [];
  private s: Snapshot = {
    level: null,
    loadMw: null,
    replayClock: "",
    loadHistory: [],
    watts: null,
    powerSource: "",
    routed: 0,
    downshifted: 0,
    deferred: 0,
    youCount: 0,
    scorecard: null,
    decisions: [],
    narrator: "",
    simFlags: 0,
    lastYou: null,
  };

  constructor(private homeCount: number, private now: () => number = () => Date.now()) {}

  snapshot(): Snapshot {
    return { ...this.s, loadHistory: [...this.s.loadHistory], decisions: [...this.s.decisions] };
  }

  private decide(d: Omit<Decision, "ts" | "count">) {
    // Collapse a repeat of the newest row into a counter instead of a new row.
    const top = this.s.decisions[0];
    if (top && top.title === d.title && top.detail === d.detail) {
      this.s.decisions[0] = { ...top, count: top.count + 1, ts: this.now() };
      return;
    }
    this.s.decisions.unshift({ ...d, ts: this.now(), count: 1 });
    if (this.s.decisions.length > MAX_DECISIONS) this.s.decisions.length = MAX_DECISIONS;
  }

  /** Process one event; returns an orb to fly, or null. */
  process(ev: DownshiftEvent): OrbEffect | null {
    if (this.seen.has(ev.id)) return null;
    this.seen.add(ev.id);
    this.seenOrder.push(ev.id);
    if (this.seenOrder.length > MAX_SEEN) this.seen.delete(this.seenOrder.shift()!);
    this.s.simFlags |= simulatedFlag(ev);

    switch (ev.type) {
      case "prompt.received": {
        this.source.set(ev.prompt_id, ev.source);
        this.sourceOrder.push(ev.prompt_id);
        if (this.sourceOrder.length > MAX_PROMPTS) this.source.delete(this.sourceOrder.shift()!);
        return null;
      }
      case "route.decided": {
        const you = isYouPrompt(ev.prompt_id, this.source.get(ev.prompt_id));
        this.s.routed++;
        const down = ev.gear_used < ev.gear_needed;
        if (down) this.s.downshifted++;
        if (ev.deferred) this.s.deferred++;
        if (you) {
          this.s.youCount++;
          const site = siteFor(ev.prompt_id);
          this.s.lastYou = {
            promptId: ev.prompt_id,
            site,
            gearNeeded: ev.gear_needed,
            gearUsed: ev.gear_used,
            deferred: ev.deferred,
            at: this.now(),
          };
          this.decide({
            id: ev.id,
            tone: "you",
            title: `You · ${site}`,
            detail: ev.deferred
              ? `queued for later (needed Gear ${ev.gear_needed})`
              : down
                ? `Gear ${ev.gear_needed} → ${ev.gear_used}, shifted down`
                : `Gear ${ev.gear_used}, full power`,
          });
        }
        if (ev.deferred) return null; // queued, not flown
        return {
          promptId: ev.prompt_id,
          home: you ? -1 : homeIndexFor(ev.prompt_id, this.homeCount),
          color: down ? SPARK_GREEN : SPARK_AMBER,
          you,
        };
      }
      case "grid.load": {
        this.s.loadMw = ev.load_mw;
        this.s.replayClock = ev.replay_clock;
        this.s.loadHistory.push(ev.load_mw);
        if (this.s.loadHistory.length > MAX_HISTORY) this.s.loadHistory.shift();
        return null;
      }
      case "grid.state": {
        if (this.s.level !== null && ev.level !== this.s.level) {
          this.decide({
            id: ev.id,
            tone: ev.level === "red" ? "warn" : "grid",
            title: `Grid ${ev.level}`,
            detail: `${formatMw(ev.load_mw)}${ev.source === "live" ? " · manual alert" : ""}`,
          });
        }
        this.s.level = ev.level;
        this.s.loadMw = ev.load_mw;
        if (ev.replay_clock) this.s.replayClock = ev.replay_clock;
        return null;
      }
      case "power.sample":
        this.s.watts = ev.watts;
        this.s.powerSource = ev.source;
        return null;
      case "scorecard.update":
        this.s.scorecard = ev;
        return null;
      case "narrator.line":
        this.s.narrator = ev.text;
        return null;
      case "utility.request":
        this.decide({
          id: ev.id,
          tone: "utility",
          title: "Utility asks for a cut",
          detail: `${ev.cut_pct}% for ${ev.duration_min} min`,
        });
        return null;
      case "coordinator.commit":
        this.decide({
          id: ev.id,
          tone: "coordinator",
          title: "Coordinator commits",
          detail: `${ev.committed_cut_pct}% cut · gears −${ev.policy.gear_offset}${
            ev.policy.defer_batch ? " · batch deferred" : ""
          }`,
        });
        return null;
      case "coordinator.report":
        this.decide({
          id: ev.id,
          tone: "coordinator",
          title: "Coordinator reports",
          detail: `achieved ${Math.round(ev.achieved_cut_pct)}% cut`,
        });
        return null;
      case "utility.verdict":
        this.decide({
          id: ev.id,
          tone: ev.accepted ? "ok" : "warn",
          title: ev.accepted ? "Utility accepts" : "Utility flags a shortfall",
          detail: ev.accepted ? "delivered on target" : `short by ${Math.round(ev.shortfall_pct)} pts`,
        });
        return null;
      default:
        return null;
    }
  }
}
