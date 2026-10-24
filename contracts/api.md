# HTTP API contract

**FROZEN after Phase 0.** Served by the engine on `localhost:8000`.
Change only via a joint `contract:` PR both owners approve.

Owners: A = Aru (demand side), B = Junaid (supply side).

| Method & path | Owner | Purpose |
| --- | --- | --- |
| `POST /v1/triage` | A | `{prompt}` → `{gear, confidence, label, reason}`. Must answer under 150 ms. |
| `POST /v1/answer` | A | `{prompt, mode: "auto" \| "gear N", protected?}` → `{text, gear_used, model, latency_ms, energy_j, energy_source}` |
| `GET /v1/grid` | A | Latest `grid.state` |
| `POST /v1/demo/alert` | A | `{level}` manual Grid Alert for the demo |
| `POST /v1/demo/replay` | B | `{date, speed}` starts the June 24, 2025 replay (default 24h in 3 min) |
| `POST /v1/utility/request` | B | `{cut_pct, duration_min}` request a cut |
| `POST /v1/chat/completions` | Stretch | OpenAI-compatible. Model `downshift-auto`. Headers `X-Downshift-Deferrable`, `X-Downshift-Priority: critical` |
| `WS /v1/stream` | Joint | All events; the last 50 on connect |

## Request / response shapes

### POST /v1/triage
```json
// request
{ "prompt": "what's 15% of 80" }
// response
{ "gear": 1, "confidence": 0.92, "label": "Quick", "reason": "arithmetic, short" }
```

### POST /v1/answer
```json
// request
{ "prompt": "write a haiku about the grid", "mode": "auto", "protected": false }
// response
{
  "text": "...",
  "gear_used": 2,
  "model": "llama3.2:1b",
  "latency_ms": 480,
  "energy_j": 12.4,
  "energy_source": "measured"
}
```
`mode` is `"auto"` or `"gear N"` (e.g. `"gear 3"`). `protected: true` means never shift.

### GET /v1/grid
Returns the latest `grid.state` event body.

### POST /v1/demo/alert
```json
{ "level": "red" }   // "green" | "yellow" | "red"
```

### POST /v1/demo/replay
```json
{ "date": "2025-06-24", "speed": 480 }   // speed = replay minutes per real second
```

### POST /v1/utility/request
```json
{ "cut_pct": 25, "duration_min": 120 }
```

### WS /v1/stream
On connect, the server sends the last 50 events, then streams every new event as
JSON text frames. Event shapes are defined in `contracts/events.py` /
`contracts/events.ts`.

## CORS & ports
- Engine: `8000`. Grid Room: `5173`.
- CORS allows `chrome-extension://*` and `http://localhost:5173`.
