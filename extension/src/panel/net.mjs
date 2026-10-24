// Network client — thin wrapper over WebSocket + fetch.
// Keeps DOM out; callers pass handlers. Uses backoff.mjs for reconnection.

import { createBackoff } from "./backoff.mjs";
import { wsUrlFor, answerUrlFor } from "./config.mjs";

// Connect to the engine WS stream. Returns a controller with stop().
// handlers: { onEvent(evt), onStatus("connecting"|"online"|"offline") }
export function connectStream(base, handlers = {}) {
  const onEvent = handlers.onEvent || (() => {});
  const onStatus = handlers.onStatus || (() => {});
  const backoff = createBackoff({ base: 500, max: 15000 });
  let ws = null;
  let timer = null;
  let stopped = false;

  function open() {
    if (stopped) return;
    onStatus("connecting");
    let url;
    try {
      url = wsUrlFor(base);
    } catch {
      scheduleReconnect();
      return;
    }
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      backoff.reset();
      onStatus("online");
    };
    ws.onmessage = (msg) => {
      let data;
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      // Server may send the last-50 as an array, or single events.
      if (Array.isArray(data)) data.forEach((e) => onEvent(e));
      else onEvent(data);
    };
    ws.onerror = () => {
      // onclose will follow; let it handle reconnect.
    };
    ws.onclose = () => {
      if (stopped) return;
      onStatus("offline");
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(open, backoff.next());
  }

  open();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

// POST a prompt to /v1/answer. Resolves with the answer body or throws a
// plain-language Error the UI can show directly.
export async function postAnswer(base, { prompt, mode, protectedMode }) {
  const url = answerUrlFor(base);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, mode, protected: !!protectedMode }),
    });
  } catch {
    throw new Error("Can't reach the engine. Is it running?");
  }
  if (!res.ok) {
    throw new Error(`The engine returned an error (HTTP ${res.status}).`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error("The engine sent a response we couldn't read.");
  }
}
