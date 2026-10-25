"""A (PR A4): Triage. Rules-only classifier (the trained model is A4-full later).

Listens: prompt.received  ->  Emits: triage.decided.
Serves: POST /v1/triage  ->  {gear, confidence, label, reason}  (< 150 ms).
        With `observe: true` (a prompt the user really sent on claude.ai),
        it also announces the prompt so Triage + Coordinator route it, and
        returns that route. No answer is generated.

Gears (see contracts/gears.json):
  1 Quick    - a fact, a sum, a one-line rewrite, very short
  2 Light    - summarize, extract, short explanation
  3 Standard - multi-paragraph writing, simple code
  4 Heavy    - multi-step reasoning, real code
  5 Max      - hard math, architecture, long constrained writing

Two entry points:
  * classify(prompt)          - raw text is available (the /v1/triage HTTP path)
  * classify_from_event(ev)   - prompt.received carries `chars`/`town`, NOT text,
                                so the crowd path classifies from length heuristics.
"""

from __future__ import annotations

import re
import uuid

# User-facing labels — exact strings from contracts/gears.json ("user_sees").
GEAR_LABELS = {1: "Quick", 2: "Light", 3: "Standard", 4: "Heavy", 5: "Max"}

# --- keyword signals --------------------------------------------------------
# Arithmetic / simple-fact signals -> Gear 1.
_ARITHMETIC_RE = re.compile(
    r"(\d+\s*%|\bpercent\b|\d+\s*[-+*/x×÷]\s*\d+|\bsum\b|\bplus\b|\bminus\b|"
    r"\btimes\b|\bdivided by\b|\bsquare root\b|\bsqrt\b)",
    re.IGNORECASE,
)
_FACT_PREFIX_RE = re.compile(
    r"^(what\s+is|what's|whats|who\s+is|who's|when\s+(is|was|did)|where\s+is|"
    r"define|capital of|how many|how much|convert)\b",
    re.IGNORECASE,
)
_REWRITE_RE = re.compile(
    r"\b(rewrite|rephrase|reword|fix (the )?(typo|grammar|spelling)|"
    r"capitali[sz]e|translate this (word|phrase)|spell)\b",
    re.IGNORECASE,
)

# Light work -> Gear 2.
_LIGHT_RE = re.compile(
    r"\b(summar(i[sz]e|y)|tl;?dr|extract|list the|bullet points?|"
    r"short explanation|briefly explain|explain .*in a sentence|classify|"
    r"what does .* mean|key points?|outline)\b",
    re.IGNORECASE,
)

# Standard work -> Gear 3.
_STANDARD_RE = re.compile(
    r"\b(write (a|an|me)?\s*(paragraph|email|blog|post|story|poem|haiku|essay|"
    r"letter|readme|docstring)|draft|compose|simple (script|function|program)|"
    r"write (some )?code|a function that|regex for)\b",
    re.IGNORECASE,
)

# Heavy work -> Gear 4.
_HEAVY_RE = re.compile(
    r"\b(debug|refactor|implement|build (a|an)|step[- ]by[- ]step|"
    r"explain why|walk me through|multi[- ]step|unit tests?|"
    r"fix (this )?(bug|error|exception)|algorithm|data structure|"
    r"optimi[sz]e|trace through)\b",
    re.IGNORECASE,
)

# Max work -> Gear 5.
_MAX_RE = re.compile(
    r"\b(prove|proof|theorem|derive|architecture|design (a|an) (system|"
    r"distributed|scalable)|scalable system|microservices?|trade[- ]?offs?|"
    r"optimi[sz]ation problem|np[- ]hard|dynamic programming|"
    r"research (paper|proposal)|dissertation|formal (verification|proof)|"
    r"multiverse|parallel universes?)\b",
    re.IGNORECASE,
)

_CODE_FENCE_RE = re.compile(r"```|def \w+\(|class \w+|function \w+\(|import \w+")


def classify(prompt: str) -> tuple[int, float, str]:
    """Classify raw prompt text into (gear 1-5, confidence, reason). Instant."""
    text = (prompt or "").strip()
    if not text:
        return 1, 0.50, "empty prompt, default Quick"

    lower = text.lower()
    length = len(text)
    words = len(text.split())

    # 5 Max — hardest signals win first.
    if _MAX_RE.search(text):
        return 5, 0.88, "hard reasoning / architecture / proof"

    # 4 Heavy — multi-step reasoning or real code.
    if _HEAVY_RE.search(text):
        return 4, 0.84, "multi-step reasoning or real code"

    # 1 Quick — arithmetic, a short fact, or a one-line rewrite.
    if _ARITHMETIC_RE.search(text):
        return 1, 0.92, "arithmetic, short"
    if _REWRITE_RE.search(text) and words <= 20:
        return 1, 0.85, "one-line rewrite"
    if _FACT_PREFIX_RE.search(text) and words <= 14:
        return 1, 0.82, "short factual lookup"

    # 3 Standard — multi-paragraph writing or simple code.
    if _STANDARD_RE.search(text) or _CODE_FENCE_RE.search(text):
        return 3, 0.80, "writing or simple code"

    # 2 Light — summarize / extract / short explanation.
    if _LIGHT_RE.search(lower):
        return 2, 0.80, "summarize / extract / short explanation"

    # No keyword hit: fall back to length buckets.
    if words <= 8 or length <= 40:
        return 1, 0.60, "very short, default Quick"
    if words <= 25:
        return 2, 0.58, "short request, default Light"
    if words <= 80:
        return 3, 0.55, "medium request, default Standard"
    return 4, 0.55, "long request, default Heavy"


def classify_from_event(ev: dict) -> tuple[int, float, str]:
    """Crowd path: prompt.received carries `chars`, not text. Bucket by length."""
    chars = ev.get("chars")
    if chars is None:
        return 2, 0.45, "no length signal, default Light"

    try:
        chars = int(chars)
    except (TypeError, ValueError):
        return 2, 0.45, "bad length signal, default Light"

    if chars <= 25:
        return 1, 0.70, f"{chars} chars, very short"
    if chars <= 80:
        return 2, 0.65, f"{chars} chars, short"
    if chars <= 240:
        return 3, 0.60, f"{chars} chars, medium"
    if chars <= 600:
        return 4, 0.58, f"{chars} chars, long"
    return 5, 0.55, f"{chars} chars, very long"


# Text-based triage results for prompts whose text the API already has, keyed by
# prompt_id. prompt.received carries only `chars`, so /v1/answer leaves its real
# classification here and on_prompt uses it instead of the length heuristic.
HINTS: dict[str, tuple[int, float, str]] = {}

# Max route.decided entries the /v1/triage observe path keeps (oldest dropped).
_MAX_ROUTES = 1024


def classify_text(prompt: str) -> tuple[int, float, str]:
    """Best available text classification: trained model, else the rules."""
    try:
        from training.model.classifier import predict

        gear, conf, source = predict(prompt)
        return gear, conf, f"classifier ({source})"
    except Exception:
        return classify(prompt)


def register(bus, app):
    """Wire the triage agent into the engine: bus subscription + HTTP route."""

    # route.decided per prompt_id, so an observed prompt can return its route.
    # Bounded: crowd prompts are never popped, so drop the oldest entries.
    routes: dict[str, dict] = {}

    async def on_prompt(ev: dict) -> None:
        hint = HINTS.pop(ev.get("prompt_id"), None)
        gear, conf, reason = hint or classify_from_event(ev)
        await bus.publish(
            {
                "type": "triage.decided",
                "prompt_id": ev.get("prompt_id"),
                "gear_needed": gear,
                "confidence": round(conf, 2),
                "reason": reason,
            }
        )

    async def on_route(ev: dict) -> None:
        routes[ev.get("prompt_id")] = ev
        if len(routes) > _MAX_ROUTES:
            routes.pop(next(iter(routes)))

    bus.subscribe("prompt.received", on_prompt)
    bus.subscribe("route.decided", on_route)

    @app.post("/v1/triage")
    async def triage(body: dict) -> dict:
        prompt = body.get("prompt", "")
        # Prefer the trained classifier (A4-full); it falls back to these rules
        # internally if the model or its deps are unavailable.
        gear, conf, reason = classify_text(prompt)
        out = {
            "gear": gear,
            "confidence": round(conf, 2),
            "label": GEAR_LABELS[gear],
            "reason": reason,
        }
        if not body.get("observe"):
            return out

        # The user really sent this prompt on claude.ai: announce it so the
        # real Triage + Coordinator route it (the Grid Room sparks on the
        # route). bus.publish awaits handlers inline, so prompt.received ->
        # triage.decided -> route.decided has run by the time it returns.
        prompt_id = body.get("prompt_id") or ("ext-" + uuid.uuid4().hex[:8])
        HINTS[prompt_id] = (gear, conf, reason)
        received = {
            "type": "prompt.received",
            "prompt_id": prompt_id,
            "source": body.get("source", "extension"),
            "chars": len(prompt),
        }
        if body.get("town"):
            received["town"] = body["town"]
        await bus.publish(received)
        HINTS.pop(prompt_id, None)

        route = routes.pop(prompt_id, None)
        out["prompt_id"] = prompt_id
        out["route"] = (
            {
                "gear_needed": route["gear_needed"],
                "gear_used": route["gear_used"],
                "deferred": route["deferred"],
            }
            if route
            else None
        )
        return out

    return None
