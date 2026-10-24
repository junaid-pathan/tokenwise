# Narrator (B5)

Plain-language play-by-play for the Grid Room. `register(bus, app)` wires it in.

## What it listens to
`coordinator.commit`, `coordinator.report`, `utility.verdict`, `utility.request`,
and `grid.state` **level changes only** (a repeated same-level state is ignored).

## What it emits
`narrator.line {text, refs}` where `refs` are the ids of the events the line
describes. At most **one line per 8 real seconds** (`NARRATOR_INTERVAL_S`), and
each line is **≤ 18 words**.

## Number guard (the safety net)
Every number in a line must appear in the cited events (allowing obvious display
roundings, e.g. `24180.0 -> 24,180`, `24.3 -> 24.3` or `24`). Any line with an
unsupported number, or over 18 words, is rejected and replaced by the
deterministic **template** line. We never publish an unverified line. See
`guard.py` and the Done-when test in `test_agent.py`.

## Rate-limit / coalesce policy
Bus handlers only enqueue a "fact" and return immediately, so they never block
the bus. Pending facts are keyed by kind, so a burst of the same kind coalesces
to its latest value (repeated grid levels never flood). A background drainer
wakes every interval and publishes exactly one line: the **highest-priority**
pending fact, ties broken by most-recent arrival. Priority:

    utility.verdict (40) > coordinator.report (35) > coordinator.commit (30)
    > utility.request (20) > grid.state level (10)

So a verdict or commit always outranks a repeated level.

## LLM lines (optional)
When enabled, a fast Bedrock model (gear-1 `bedrock_model` from
`contracts/gears.json`, read at runtime) rephrases the template line. The call
runs off the event loop (`asyncio.to_thread`) with a ~3 s timeout, and the
result is re-checked by the **same guard**; any failure (exception, timeout, no
credentials, too long, bad number, empty) falls back to the template.

Env:
- `NARRATOR_USE_LLM` — `0` disables; `1` forces on; default: on when AWS
  credentials are present.
- `NARRATOR_MAX_LLM_CALLS` — per-process cap (default 60).
- `NARRATOR_INTERVAL_S` — seconds between lines (default 8; tests shorten it).

Users never see the words "model" or "tokens".

## Tests
```
pytest engine/agents/narrator/
```
