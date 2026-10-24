// Hand-off parsing — pure logic, no DOM, no chrome.* access.
// Aru's content script (A9) hands a prompt to the panel two ways:
//   (a) chrome.storage.session/local key "downshift_pending"
//       = { prompt, gear_suggested, ts }
//   (b) runtime message { type: "downshift.open", prompt, gear_suggested }
// Both are normalised here into { prompt, position } where position feeds the
// shifter (via modeToPosition). Invalid payloads return null so the panel just
// opens empty.

import { modeToPosition } from "./shifter.mjs";

export const PENDING_KEY = "downshift_pending";

// Normalise either a pending-storage object or a runtime message body.
export function parseHandoff(payload) {
  if (!payload || typeof payload !== "object") return null;
  // Runtime message must have the right type; storage object has no type.
  if ("type" in payload && payload.type !== "downshift.open") return null;
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (prompt === "") return null;
  const position = modeToPosition(payload.gear_suggested);
  return { prompt, position };
}

// Is this a valid runtime message we should act on?
export function isOpenMessage(msg) {
  return !!msg && typeof msg === "object" && msg.type === "downshift.open";
}
