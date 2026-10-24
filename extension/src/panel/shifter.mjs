// Shifter state machine — pure logic, no DOM.
// Positions: "auto" + gears 1..5. The UI lays these out as an H-pattern, but
// the state machine treats them as an ordered list for arrow-key navigation:
//   Auto, Quick(1), Light(2), Standard(3), Heavy(4), Max(5)
//
// mode() returns the engine `mode` string for /v1/answer:
//   "auto"  when position is "auto"
//   "gear N" when position is a gear number

export const POSITIONS = ["auto", 1, 2, 3, 4, 5];

export function createShifter(initial = "auto") {
  let pos = isValid(initial) ? initial : "auto";
  return {
    position: () => pos,
    set(next) {
      if (isValid(next)) pos = next;
      return pos;
    },
    mode: () => positionToMode(pos),
    // Arrow navigation over the ordered POSITIONS list.
    next() {
      pos = step(pos, +1);
      return pos;
    },
    prev() {
      pos = step(pos, -1);
      return pos;
    },
    home() {
      pos = POSITIONS[0];
      return pos;
    },
    end() {
      pos = POSITIONS[POSITIONS.length - 1];
      return pos;
    },
  };
}

export function isValid(p) {
  return POSITIONS.includes(p);
}

export function positionToMode(p) {
  return p === "auto" ? "auto" : `gear ${p}`;
}

// Parse an incoming mode string (e.g. a suggested gear from the content script)
// back into a position. Accepts numbers, "gear N", "auto", or gear names.
export function modeToPosition(mode) {
  if (mode === "auto" || mode == null) return "auto";
  if (typeof mode === "number") return isValid(mode) ? mode : "auto";
  const s = String(mode).trim().toLowerCase();
  if (s === "auto" || s === "") return "auto";
  const m = s.match(/^gear\s*(\d)$/);
  if (m) {
    const n = Number(m[1]);
    return isValid(n) ? n : "auto";
  }
  const asNum = Number(s);
  if (Number.isInteger(asNum) && isValid(asNum)) return asNum;
  const names = {
    quick: 1, light: 2, standard: 3, heavy: 4, max: 5,
    wooden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5,
  };
  if (s in names) return names[s];
  return "auto";
}

function step(pos, dir) {
  const i = POSITIONS.indexOf(pos);
  const n = POSITIONS.length;
  const j = (i + dir + n) % n; // wrap around
  return POSITIONS[j];
}
