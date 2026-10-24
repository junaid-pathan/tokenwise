// Pure event -> effect mapping. No React, no three. Unit-testable in Node.
//
// Turns the raw bus event stream into the small set of "effects" the scene
// cares about: a new spark to fly, a grid-level change, a power sample. All
// per-event state (dedup set, prompt->town map) lives here so the React layer
// only has to feed events in and read effects out.

import type { DownshiftEvent, GridLevel } from "../../../contracts/events.ts";
import { sparkColor } from "./colors.ts";

export const DEFAULT_TOWN = "Boston";

export interface SparkEffect {
  kind: "spark";
  town: string; // resolved town name (may be the default fallback)
  lon: number;
  lat: number;
  color: string; // amber or green
}

export interface LevelEffect {
  kind: "level";
  level: GridLevel;
}

export interface PowerEffect {
  kind: "power";
  watts: number;
}

export type Effect = SparkEffect | LevelEffect | PowerEffect;

// Max prompt_id -> town entries kept (bounded; oldest pruned).
const MAX_TOWN_MAP = 4096;
// Max processed event ids kept (bounded; oldest pruned).
const MAX_SEEN = 4096;

/** Normalise a town name to the canonical casing used in the centroids file. */
export function canonicalTown(
  raw: string | null | undefined,
  centroids: Record<string, [number, number]>
): string | null {
  if (!raw) return null;
  if (raw in centroids) return raw;
  const lower = raw.toLowerCase();
  for (const name of Object.keys(centroids)) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

export class EventProcessor {
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private promptTown = new Map<string, string>();
  private townOrder: string[] = [];

  constructor(
    private centroids: Record<string, [number, number]>,
    private defaultTown: string = DEFAULT_TOWN
  ) {}

  private remember(id: string): boolean {
    // Returns true if this id is new (and records it), false if already seen.
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > MAX_SEEN) {
      const old = this.seenOrder.shift()!;
      this.seen.delete(old);
    }
    return true;
  }

  private rememberTown(promptId: string, town: string) {
    if (!this.promptTown.has(promptId)) this.townOrder.push(promptId);
    this.promptTown.set(promptId, town);
    if (this.townOrder.length > MAX_TOWN_MAP) {
      const old = this.townOrder.shift()!;
      this.promptTown.delete(old);
    }
  }

  private resolveCoords(town: string): [number, number] | null {
    return this.centroids[town] ?? null;
  }

  /**
   * Process one event exactly once (dedup by id). Returns the effect it
   * produces, or null if the event is a no-op / already seen / deferred.
   */
  process(ev: DownshiftEvent): Effect | null {
    if (ev.id && !this.remember(ev.id)) return null;

    switch (ev.type) {
      case "prompt.received": {
        const resolved =
          canonicalTown(ev.town, this.centroids) ?? this.defaultTown;
        this.rememberTown(ev.prompt_id, resolved);
        return null; // learning only; the spark fires on route.decided
      }
      case "route.decided": {
        if (ev.deferred) return null; // queued, not flown
        const town = this.promptTown.get(ev.prompt_id) ?? this.defaultTown;
        const coords = this.resolveCoords(town) ?? this.resolveCoords(this.defaultTown);
        if (!coords) return null;
        return {
          kind: "spark",
          town,
          lon: coords[0],
          lat: coords[1],
          color: sparkColor(ev.gear_used, ev.gear_needed),
        };
      }
      case "grid.state":
        return { kind: "level", level: ev.level };
      case "power.sample":
        return { kind: "power", watts: ev.watts };
      default:
        return null;
    }
  }
}
